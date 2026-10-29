using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Tandem.Desktop;

internal sealed class MainForm : Form
{
    private readonly DesktopOptions _options;
    private readonly DiagnosticLog _log = new();
    private readonly ToolStripButton _open = new("Open folder…");
    private readonly ToolStripButton _reload = new("Reload page") { Enabled = false };
    private readonly ToolStripDropDownButton _permissions = new("Upstream permissions: Ask each time") { Enabled = false };
    private readonly ToolStripMenuItem _askEachTime = new("Ask each time") { Checked = true };
    private readonly ToolStripMenuItem _allowAll = new("Allow all for this session");
    private readonly ToolStripLabel _workspaceLabel = new("No workspace selected");
    private readonly ToolStripStatusLabel _status = new("Choose a workspace to begin")
    {
        Spring = true, TextAlign = ContentAlignment.MiddleLeft
    };
    private readonly Panel _content = new() { Dock = DockStyle.Fill };
    private readonly Panel _notice = new() { Dock = DockStyle.Fill, Padding = new Padding(32) };
    private readonly Label _noticeTitle = new()
    {
        Dock = DockStyle.Top, AutoSize = false, Height = 60,
        Font = new Font(SystemFonts.MessageBoxFont!.FontFamily, 18, FontStyle.Bold)
    };
    private readonly TextBox _noticeDetails = new()
    {
        Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, BorderStyle = BorderStyle.None,
        BackColor = SystemColors.Control, ScrollBars = ScrollBars.Vertical, TabStop = false
    };
    private readonly Button _retry = new() { Text = "Retry", AutoSize = true, Enabled = false };
    private readonly SemaphoreSlim _promptGate = new(1, 1);
    private readonly System.Windows.Forms.Timer _startupTimer = new() { Interval = 60_000 };
    private readonly System.Windows.Forms.Timer _smokeTimer = new() { Interval = 90_000 };
    private readonly Dictionary<(BackendProcess Backend, string Id), (CancellationTokenSource Cancellation, bool Permission)> _pendingRequests = [];
    private BackendProcess? _backend;
    private WebView2? _webView;
    private Uri? _trustedOrigin;
    private string? _workspace;
    private string? _backendSessionId;
    private CancellationTokenSource _sessionCancellation = new();
    private Task _transition = Task.CompletedTask;
    private Form? _activePrompt;
    private Form? _diagnostics;
    private TextBox? _diagnosticText;
    private int _pendingPrompts;
    private int _topLevelNavigations;
    private bool _switching;
    private bool _closing;
    private bool _closeAllowed;
    private bool _failed;
    private bool _smokeChecking;
    private bool _smokeFinished;
    private bool _backendReady;
    private bool _permissionModeReported;
    private string _permissionMode = "ask";

    internal MainForm(DesktopOptions options)
    {
        _options = options;
        Text = "Tandem";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 650);
        Size = new Size(1320, 900);
        AutoScaleMode = AutoScaleMode.Dpi;
        var toolbar = new ToolStrip { GripStyle = ToolStripGripStyle.Hidden, Padding = new Padding(8, 5, 8, 5) };
        var diagnostics = new ToolStripButton("Diagnostics");
        var about = new ToolStripButton("About");
        _permissions.DropDownItems.AddRange([_askEachTime, _allowAll]);
        toolbar.Items.AddRange([_open, _reload, _permissions, new ToolStripSeparator(), diagnostics, about,
            new ToolStripSeparator(), _workspaceLabel]);
        var statusStrip = new StatusStrip();
        statusStrip.Items.Add(_status);
        var noticeActions = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom, Height = 50, FlowDirection = FlowDirection.LeftToRight
        };
        var choose = new Button { Text = "Open folder…", AutoSize = true };
        noticeActions.Controls.Add(_retry);
        noticeActions.Controls.Add(choose);
        _notice.Controls.Add(_noticeDetails);
        _notice.Controls.Add(_noticeTitle);
        _notice.Controls.Add(noticeActions);
        _content.Controls.Add(_notice);
        Controls.Add(_content);
        Controls.Add(statusStrip);
        Controls.Add(toolbar);
        _open.Click += (_, _) => ChooseWorkspace();
        choose.Click += (_, _) => ChooseWorkspace();
        _retry.Click += (_, _) => BeginWorkspace(_workspace, true);
        _reload.Click += (_, _) =>
        {
            if (_webView?.CoreWebView2 is not null && !_failed) _webView.Reload();
        };
        diagnostics.Click += (_, _) => ShowDiagnostics();
        _askEachTime.Click += async (_, _) => await ChangePermissionModeAsync("ask");
        _allowAll.Click += async (_, _) => await ChangePermissionModeAsync("allow-all");
        about.Click += (_, _) => MessageBox.Show(this,
            $"Tandem {Program.Version}\nWindows desktop host\n\n" +
            "Copilot runs in an independent backend for the selected workspace.\n" +
            "Tool permissions start in Ask each time. Allow all applies only to the current backend session.\n" +
            "Only open workspaces and tools you trust.",
            "About Tandem", MessageBoxButtons.OK, MessageBoxIcon.Information);
        _log.Changed += () =>
        {
            if (_diagnosticText is null || _diagnosticText.IsDisposed) return;
            Post(() =>
            {
                if (_diagnosticText is not null && !_diagnosticText.IsDisposed)
                {
                    _diagnosticText.Text = _log.Snapshot();
                    _diagnosticText.SelectionStart = _diagnosticText.TextLength;
                    _diagnosticText.ScrollToCaret();
                }
            });
        };
        _startupTimer.Tick += (_, _) =>
        {
            _startupTimer.Stop();
            Fail("Startup timed out",
                "The backend or page did not become ready within 60 seconds. Check Diagnostics, verify " +
                "Node.js and Copilot authentication, then retry or open another folder.");
        };
        _smokeTimer.Tick += (_, _) => FinishSmoke(false, "The GUI did not become ready within 90 seconds.");
        Shown += (_, _) =>
        {
            if (_options.SmokeReport is not null) _smokeTimer.Start();
            if (_options.Workspace is not null) BeginWorkspace(_options.Workspace, false);
            else ChooseWorkspace();
        };
        FormClosing += OnFormClosing;
        ShowNotice("Welcome to Tandem", "Open a workspace folder to start its independent Copilot backend.");
    }

    private void Post(Action action)
    {
        if (IsDisposed || Disposing || !IsHandleCreated) return;
        try
        {
            BeginInvoke(new Action(() =>
            {
                if (!IsDisposed && !_closing) action();
            }));
        }
        catch (InvalidOperationException) { }
    }

    private void ChooseWorkspace()
    {
        if (_closing || _switching) return;
        using var picker = new FolderBrowserDialog
        {
            Description = "Choose the workspace Tandem should use",
            UseDescriptionForTitle = true,
            SelectedPath = _workspace ?? WorkspacePreferences.Read(_log.Write) ?? "",
            ShowNewFolderButton = true
        };
        if (picker.ShowDialog(this) == DialogResult.OK) BeginWorkspace(picker.SelectedPath, true);
    }

    private void BeginWorkspace(string? workspace, bool confirm)
    {
        if (workspace is null || _closing || _switching) return;
        if (confirm && _backend is not null &&
            MessageBox.Show(this,
                "Changing or restarting the workspace stops its Copilot backend. Tandem operations may " +
                "still be active and will be interrupted.\n\nContinue?",
                "Stop the current workspace?", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2) != DialogResult.OK) return;
        _transition = OpenWorkspaceAsync(workspace);
    }

    private async Task OpenWorkspaceAsync(string workspace)
    {
        _switching = true;
        _open.Enabled = _retry.Enabled = _reload.Enabled = _permissions.Enabled = false;
        _startupTimer.Stop();
        CancelPrompts();
        try
        {
            _trustedOrigin = null;
            if (_backend is not null)
            {
                SetStatus("Stopping the previous workspace…");
                var previous = _backend;
                _backend = null;
                await previous.DisposeAsync();
            }
            _webView?.Dispose();
            _webView = null;
            if (_closing) return;
            _sessionCancellation.Dispose();
            _sessionCancellation = new CancellationTokenSource();
            _workspace = Path.GetFullPath(workspace);
            _failed = false;
            _backendReady = false;
            _permissionModeReported = false;
            _backendSessionId = null;
            UpdatePermissionMode("ask");
            _topLevelNavigations = 0;
            _workspaceLabel.Text = CompactPath(_workspace);
            _workspaceLabel.ToolTipText = _workspace;
            if (!Directory.Exists(_workspace))
                throw new DirectoryNotFoundException(
                    "The selected workspace folder no longer exists. Choose another folder or restore it, then retry.");
            _log.SetWorkspace(_workspace);
            _log.Write("Starting Tandem desktop " + Program.Version + ".");
            if (_options.SmokeReport is null) WorkspacePreferences.Save(_workspace, _log.Write);
            ShowNotice("Starting Tandem", "Preparing the embedded browser and independent Copilot backend…");
            SetStatus("Starting WebView2…");
            _startupTimer.Start();
            var token = _sessionCancellation.Token;
            var webView = new WebView2 { Dock = DockStyle.Fill, Visible = false };
            _webView = webView;
            _content.Controls.Add(webView);
            var profile = Path.Combine(WorkspacePreferences.AppData, "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile).WaitAsync(token);
            await webView.EnsureCoreWebView2Async(environment).WaitAsync(token);
            token.ThrowIfCancellationRequested();
            ConfigureBrowser(webView);
            var backend = new BackendProcess(_log);
            _backend = backend;
            backend.MessageReceived += message => Post(() =>
            {
                if (ReferenceEquals(_backend, backend) && !backend.IsStopping) HandleMessage(backend, message);
            });
            backend.Exited += code => Post(() =>
            {
                if (ReferenceEquals(_backend, backend) && !backend.IsStopping)
                    Fail("The Tandem backend exited",
                        $"The backend stopped with exit code {code}. Check Diagnostics for the reason, " +
                        "then retry. No backend is running for this page.");
            });
            SetStatus("Starting Copilot backend…");
            backend.Start(_workspace);
        }
        catch (OperationCanceledException) when (_sessionCancellation.IsCancellationRequested)
        {
            // Closing, switching, or a startup failure owns cleanup.
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Fail("WebView2 Runtime is missing",
                "Install the Microsoft Edge WebView2 Evergreen Runtime from " +
                "https://developer.microsoft.com/microsoft-edge/webview2/ and retry. " +
                "The .NET Desktop Runtime is separate from WebView2.");
        }
        catch (Exception ex)
        {
            Fail("Tandem could not start",
                DiagnosticLog.Sanitize(ex.Message) +
                "\n\nCheck Diagnostics for details, then retry or open another folder.");
        }
        finally
        {
            _switching = false;
            if (!_closing)
            {
                _open.Enabled = true;
                _retry.Enabled = _workspace is not null;
            }
        }
    }

    private void HandleMessage(BackendProcess backend, BackendEvent message)
    {
        if (_failed) return;
        switch (message.Type)
        {
            case "status":
                if (!string.IsNullOrWhiteSpace(message.Message)) SetStatus(message.Message);
                break;
            case "ready":
                if (!_permissionModeReported)
                {
                    Fail("The backend needs updating",
                        "The backend did not report its permission mode. Rebuild the desktop backend before continuing.");
                    break;
                }
                if (!SecurityPolicy.TryReadyOrigin(message.Url, out var origin) ||
                    !MatchesWorkspace(message.Workspace) || string.IsNullOrWhiteSpace(message.SessionId))
                {
                    Fail("Invalid backend startup response",
                        "The backend did not provide a valid loopback address and matching workspace. " +
                        "Update or rebuild the desktop backend, then retry.");
                    break;
                }
                if (_backendReady)
                {
                    if (_trustedOrigin == origin &&
                        string.Equals(_backendSessionId, message.SessionId, StringComparison.Ordinal))
                    {
                        _log.Write("Ignored a duplicate backend ready event without reloading.");
                        break;
                    }
                    if (!string.Equals(_backendSessionId, message.SessionId, StringComparison.Ordinal))
                    {
                        Fail("The backend identity changed",
                            "The backend reported a different session after becoming ready. " +
                            "Retry to restart it with a consistent identity.");
                        break;
                    }
                }
                _backendReady = true;
                _backendSessionId = message.SessionId;
                _trustedOrigin = origin;
                SetStatus("Loading Tandem…");
                _webView!.CoreWebView2.Navigate(origin!.AbsoluteUri);
                break;
            case "error":
                // Error events also describe failed operations after startup, not necessarily process failure.
                if (!_backendReady) Fail("The backend could not start", message.Message ?? "Check Diagnostics, then retry.");
                else SetStatus("Backend error: " + (message.Message ?? "See Diagnostics."));
                break;
            case "permission":
            case "question":
                _ = HandleRequestAsync(backend, message, _sessionCancellation.Token);
                break;
            case "permission-mode":
                if (message.Mode is not ("ask" or "allow-all"))
                {
                    Fail("Invalid permission mode", "The backend returned an unsupported tool permission mode.");
                    break;
                }
                UpdatePermissionMode(message.Mode);
                _permissionModeReported = true;
                _permissions.Enabled = true;
                break;
            case "permission-resolved":
                if (message.Id is not null &&
                    _pendingRequests.TryGetValue((backend, message.Id), out var pending) && pending.Permission)
                    pending.Cancellation.Cancel();
                break;
            case "stopped":
                Fail("The Tandem backend stopped", "Retry to start a new backend, or open another workspace.");
                break;
        }
    }

    private bool MatchesWorkspace(string? workspace)
    {
        try
        {
            return workspace is not null && Path.IsPathFullyQualified(workspace) &&
                string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(workspace)),
                    Path.TrimEndingDirectorySeparator(_workspace!), StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or IOException)
        {
            return false;
        }
    }

    private void ConfigureBrowser(WebView2 webView)
    {
        var core = webView.CoreWebView2;
        core.Settings.IsWebMessageEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.NavigationStarting += (_, args) =>
        {
            if (ReferenceEquals(_webView, webView) && !_failed &&
                SecurityPolicy.IsTrusted(_trustedOrigin, args.Uri))
            {
                _topLevelNavigations++;
                return;
            }
            args.Cancel = true;
            if (args.IsUserInitiated && ReferenceEquals(_webView, webView))
            {
                var address = args.Uri;
                var token = _sessionCancellation.Token;
                Post(() => _ = OpenExternalAsync(address, token));
            }
        };
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (!args.IsUserInitiated || !ReferenceEquals(_webView, webView) || _failed) return;
            var address = args.Uri;
            Post(() =>
            {
                if (!ReferenceEquals(_webView, webView) || _failed) return;
                if (SecurityPolicy.IsTrusted(_trustedOrigin, address)) core.Navigate(address);
                else _ = OpenExternalAsync(address, _sessionCancellation.Token);
            });
        };
        // NavigationStarting is top-level only. Prototype frames and HTTP resources remain unrestricted.
        core.PermissionRequested += (_, args) =>
        {
            args.State = CoreWebView2PermissionState.Deny;
            args.SavesInProfile = false;
        };
        core.DownloadStarting += (_, args) =>
        {
            args.Cancel = true;
            args.Handled = true;
            SetStatus("Download blocked: browser downloads are disabled in the desktop host.");
            _log.Write("Blocked a browser download. No file was saved or executed.");
        };
        core.ProcessFailed += (_, args) =>
        {
            if (ReferenceEquals(_webView, webView))
                Fail("The embedded browser failed",
                    $"WebView2 reported {args.ProcessFailedKind}. Retry to recreate the browser and backend. " +
                    "If this repeats, update the Microsoft Edge WebView2 Runtime.");
        };
        core.NavigationCompleted += (_, args) =>
        {
            if (!ReferenceEquals(_webView, webView) || _failed || _closing) return;
            if (!args.IsSuccess)
            {
                if (args.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
                Fail("The Tandem page could not load",
                    $"WebView2 reported {args.WebErrorStatus}. Check Diagnostics and retry.");
                return;
            }
            if (!IsCurrentTrustedPage()) return;
            _startupTimer.Stop();
            _notice.Visible = false;
            webView.Visible = true;
            webView.BringToFront();
            _reload.Enabled = true;
            SetStatus("Ready");
            if (_options.SmokeReport is not null && !_smokeChecking)
                _ = CheckSmokeAsync(webView, _sessionCancellation.Token);
        };
    }

    private bool IsCurrentTrustedPage() =>
        !_closing && !_failed && _backendReady && SecurityPolicy.IsTrusted(_trustedOrigin, _webView?.Source?.AbsoluteUri);

    private void UpdatePermissionMode(string mode)
    {
        _permissionMode = mode;
        _askEachTime.Checked = mode == "ask";
        _allowAll.Checked = mode == "allow-all";
        _permissions.Text = mode == "ask" ? "Upstream permissions: Ask each time" : "Upstream permissions: Allow all (session)";
        _permissions.ToolTipText = "Preparation through Prototype only; Development has its own private permission controls. File permissions, active-work protection, managed policy, " +
            "sandbox consent and external-browser confirmation are not bypassed.";
    }

    private async Task ChangePermissionModeAsync(string mode)
    {
        var backend = _backend;
        var token = _sessionCancellation.Token;
        if (backend is null || backend.IsStopping || _failed || _closing || _switching || mode == _permissionMode) return;
        if (mode == "allow-all" && !await AskPermissionAsync("Allow all tool actions for this session?",
            "Copilot may run commands, change files and access the network without further tool confirmation. " +
            "Only enable this for workspaces and tools you trust.\n\n" +
            "This choice is not saved. Closing, restarting or switching the workspace restores Ask each time. " +
            "You can switch back at any time; already running actions are not cancelled. " +
            "Managed-policy and sandbox-bypass requests still require individual approval.",
            token, "Allow all for this session")) return;
        if (token.IsCancellationRequested || !ReferenceEquals(_backend, backend) || backend.IsStopping) return;
        _permissions.Enabled = false;
        await ReplyAsync(backend, new { type = "set-permission-mode", mode });
    }

    private async Task HandleRequestAsync(BackendProcess backend, BackendEvent message, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(message.Id) || message.Id.Length > 512)
        {
            _log.Write("Ignored a native request with a missing or invalid id.");
            return;
        }
        var requestKey = (backend, message.Id);
        if (_pendingRequests.ContainsKey(requestKey))
        {
            _log.Write("Ignored a duplicate pending native request.");
            return;
        }
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(token);
        _pendingRequests.Add(requestKey, (cancellation, message.Type == "permission"));
        token = cancellation.Token;
        try
        {
            if (message.Type == "permission")
            {
                if (string.IsNullOrWhiteSpace(message.Title) || string.IsNullOrWhiteSpace(message.Details) ||
                    message.Title.Length > 1024 || message.Details.Length > 60 * 1024)
                {
                    _log.Write("Rejected a tool permission with missing or oversized details.");
                    await ReplyAsync(backend, new { type = "permission-response", id = message.Id, approved = false });
                    return;
                }
                using var dialog = new PermissionDialog(message.Title, message.Details,
                    canAllowAllForSession: message.CanAllowAllForSession == true);
                var result = await ShowPromptAsync(dialog, token);
                if (token.IsCancellationRequested) return;
                await ReplyAsync(backend, new
                {
                    type = "permission-response", id = message.Id,
                    approved = result == DialogResult.OK || result == DialogResult.Yes,
                    allowAllForSession = result == DialogResult.Yes && message.CanAllowAllForSession == true
                });
            }
            else
            {
                var choices = message.Choices ?? [];
                if (string.IsNullOrWhiteSpace(message.Question) || message.Question.Length > 32 * 1024 ||
                    choices.Length > 64 || choices.Any(c => c is null || c.Length > 4096))
                {
                    _log.Write("Rejected a question with missing text or oversized text/choices.");
                    await ReplyAsync(backend, new { type = "question-response", id = message.Id, cancelled = true });
                    return;
                }
                using var dialog = new QuestionDialog(
                    message.Question, choices, message.AllowFreeform ?? true);
                var result = await ShowPromptAsync(dialog, token);
                if (result == DialogResult.OK && !token.IsCancellationRequested)
                    await ReplyAsync(backend, new
                    {
                        type = "question-response", id = message.Id,
                        answer = dialog.Answer, wasFreeform = dialog.WasFreeform
                    });
                else
                    await ReplyAsync(backend, new { type = "question-response", id = message.Id, cancelled = true });
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or OperationCanceledException)
        {
            _log.Write("Native request ended while the workspace was stopping.");
        }
        finally
        {
            _pendingRequests.Remove(requestKey);
        }
    }

    private async Task ReplyAsync(BackendProcess backend, object response)
    {
        if (!await backend.SendAsync(response) && !_closing && !_failed &&
            ReferenceEquals(_backend, backend) && !backend.IsStopping)
            Fail("The backend connection was lost",
                "Your answer could not be delivered. Check Diagnostics, then retry to restart the backend.");
    }

    private async Task<bool> AskPermissionAsync(string title, string details, CancellationToken token, string allowText = "Allow once")
    {
        using var dialog = new PermissionDialog(title, details, allowText);
        return await ShowPromptAsync(dialog, token) == DialogResult.OK;
    }

    private async Task<DialogResult> ShowPromptAsync(Form dialog, CancellationToken token)
    {
        if (_options.SmokeReport is not null || _closing || _pendingPrompts >= 16)
        {
            _log.Write("Native request denied: unattended verification or dialog queue limit.");
            return DialogResult.Cancel;
        }
        _pendingPrompts++;
        var sessionToken = _sessionCancellation.Token;
        var acquired = false;
        try
        {
            // Never enter a native modal loop within a WebView2 event callback.
            await Task.Yield();
            await _promptGate.WaitAsync(token);
            acquired = true;
            token.ThrowIfCancellationRequested();
            if (_closing) return DialogResult.Cancel;
            _activePrompt = dialog;
            var pauseStartup = !_backendReady && !_failed && _startupTimer.Enabled;
            if (pauseStartup) _startupTimer.Stop();
            try
            {
                using var cancellation = token.Register(() => Post(() =>
                {
                    if (ReferenceEquals(_activePrompt, dialog) && !dialog.IsDisposed) dialog.Close();
                }));
                return dialog.ShowDialog(this);
            }
            finally
            {
                if (pauseStartup && !_backendReady && !_failed && !_closing && !sessionToken.IsCancellationRequested)
                    _startupTimer.Start();
            }
        }
        catch (OperationCanceledException)
        {
            return DialogResult.Cancel;
        }
        finally
        {
            if (ReferenceEquals(_activePrompt, dialog)) _activePrompt = null;
            if (acquired) _promptGate.Release();
            _pendingPrompts--;
        }
    }

    private async Task OpenExternalAsync(string address, CancellationToken token)
    {
        if (!SecurityPolicy.TryWebAddress(address, out var uri))
        {
            SetStatus("Blocked a link with an unsupported or unsafe address.");
            return;
        }
        if (!await AskPermissionAsync("Open an external link?",
            "This link will open in your default web browser, outside Tandem.\n\n" + uri!.AbsoluteUri,
            token, "Open browser") || token.IsCancellationRequested) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            _log.Write("Could not open the default browser: " + ex.Message);
            SetStatus("Could not open your default browser. See Diagnostics.");
        }
    }

    private void CancelPrompts()
    {
        _sessionCancellation.Cancel();
        _activePrompt?.Close();
    }

    private void Fail(string title, string details)
    {
        if (_closing) return;
        _failed = true;
        _trustedOrigin = null;
        _startupTimer.Stop();
        _reload.Enabled = false;
        _permissions.Enabled = false;
        CancelPrompts();
        _log.Write(title + ": " + details);
        ShowNotice(title, DiagnosticLog.Sanitize(details));
        SetStatus(title);
        if (_options.SmokeReport is not null) FinishSmoke(false, title + ": " + details);
    }

    private void ShowNotice(string title, string details)
    {
        _noticeTitle.Text = title;
        _noticeDetails.Text = details;
        _notice.Visible = true;
        _notice.BringToFront();
        if (_webView is not null) _webView.Visible = false;
    }

    private void SetStatus(string message)
    {
        var sanitized = DiagnosticLog.Sanitize(message);
        _status.Text = Limit(sanitized.Replace('\r', ' ').Replace('\n', ' '), 220);
        _status.ToolTipText = sanitized;
    }

    private void ShowDiagnostics()
    {
        if (_diagnostics is not null && !_diagnostics.IsDisposed)
        {
            _diagnostics.Activate();
            return;
        }
        _diagnosticText = new TextBox
        {
            Dock = DockStyle.Fill, Multiline = true, ReadOnly = true,
            ScrollBars = ScrollBars.Both, WordWrap = false, Text = _log.Snapshot()
        };
        _diagnostics = new Form
        {
            Text = "Tandem diagnostics — .tandem\\desktop\\desktop.log",
            Size = new Size(950, 520), StartPosition = FormStartPosition.CenterParent,
            ShowInTaskbar = false
        };
        _diagnostics.Controls.Add(_diagnosticText);
        _diagnostics.Show(this);
    }

    private async Task CheckSmokeAsync(WebView2 view, CancellationToken token)
    {
        _smokeChecking = true;
        JsonElement? lastPage = null;
        try
        {
            for (var attempt = 0; attempt < 60 && !_smokeFinished; attempt++)
            {
                token.ThrowIfCancellationRequested();
                if (!ReferenceEquals(view, _webView) || !IsCurrentTrustedPage()) return;
                var json = await view.ExecuteScriptAsync("""
                    (() => {
                      const visible = element => !!element && !element.hidden &&
                        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
                      const header = document.querySelector('header h1');
                      const start = document.querySelector('#start-panel');
                      const studio = document.querySelector('#studio-workspace');
                      const form = document.querySelector('#start-form');
                      const tandemHeader = visible(header) && header.textContent.trim() === 'Tandem';
                      const startPage = visible(start) && visible(form);
                      const workspacePage = visible(studio);
                      return { title: document.title, documentReady: document.readyState,
                        tandemHeader, startPage, workspacePage,
                        rendered: tandemHeader && (startPage || workspacePage) };
                    })()
                    """).WaitAsync(token);
                using var result = JsonDocument.Parse(json);
                lastPage = result.RootElement.Clone();
                if (result.RootElement.GetProperty("rendered").GetBoolean() &&
                    result.RootElement.GetProperty("documentReady").GetString() == "complete")
                {
                    FinishSmoke(true, null, result.RootElement.Clone());
                    return;
                }
                await Task.Delay(500, token);
            }
            if (!_smokeFinished)
                FinishSmoke(false, "The Tandem header and interactive start/workspace page did not render.", lastPage);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            FinishSmoke(false, "GUI smoke test failed: " + DiagnosticLog.Sanitize(ex.Message));
        }
    }

    private void FinishSmoke(bool success, string? error, JsonElement? page = null)
    {
        if (_options.SmokeReport is null || _smokeFinished) return;
        _smokeFinished = true;
        _smokeTimer.Stop();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_options.SmokeReport)!);
            var report = new
            {
                success, version = Program.Version, workspace = _workspace,
                url = _trustedOrigin?.AbsoluteUri, title = page?.GetProperty("title").GetString(),
                documentReady = page?.GetProperty("documentReady").GetString(),
                rendered = page?.GetProperty("rendered").GetBoolean() ?? false,
                topLevelNavigations = _topLevelNavigations,
                toolApprovalMode = _permissionMode,
                page, error = error is null ? null : DiagnosticLog.Sanitize(error),
                timestamp = DateTimeOffset.UtcNow
            };
            File.WriteAllText(_options.SmokeReport, JsonSerializer.Serialize(report,
                new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            success = false;
            _log.Write("Could not write the smoke-test report: " + ex.Message);
        }
        Environment.ExitCode = success ? 0 : 1;
        BeginInvoke(new Action(Close));
    }

    private async void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_closeAllowed) return;
        e.Cancel = true;
        if (_closing) return;
        _closing = true;
        _startupTimer.Stop();
        _smokeTimer.Stop();
        _open.Enabled = _reload.Enabled = _retry.Enabled = _permissions.Enabled = false;
        SetStatus("Stopping Tandem…");
        CancelPrompts();
        try
        {
            await _transition;
            if (_backend is not null) await _backend.DisposeAsync();
        }
        catch (Exception ex)
        {
            _log.Write("Shutdown: " + ex.Message);
        }
        finally
        {
            _backend = null;
            _webView?.Dispose();
            _diagnostics?.Close();
            _startupTimer.Dispose();
            _smokeTimer.Dispose();
            _sessionCancellation.Dispose();
            _closeAllowed = true;
            Close();
        }
    }

    private static string Limit(string text, int max) => text.Length <= max ? text : text[..max] + "…";
    private static string CompactPath(string path) => path.Length <= 85 ? path : "…" + path[^84..];
}
