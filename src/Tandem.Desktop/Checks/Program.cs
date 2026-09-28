using System.Diagnostics;
using Tandem.Desktop;

var assertions = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException("FAILED: " + name);
    assertions++;
}

Check(SecurityPolicy.TryReadyOrigin("http://127.0.0.1:45678/", out var origin), "valid ready origin");
foreach (var invalid in new[]
{
    "http://127.0.0.1/", "http://127.0.0.1:0/", "http://127.0.0.1:65536/",
    "https://127.0.0.1:45678/", "http://localhost:45678/", "http://127.0.0.1.evil:45678/",
    "http://user@127.0.0.1:45678/", "http://127.0.0.1:45678/path",
    "http://127.0.0.1:45678/?token=secret", "http://127.0.0.1:45678/#fragment",
    "http://127.0.0.1:45678/\n", " http://127.0.0.1:45678/"
})
    Check(!SecurityPolicy.TryReadyOrigin(invalid, out _), "reject ready address: " + invalid);
Check(SecurityPolicy.IsTrusted(origin, "http://127.0.0.1:45678/studio?stage=design"), "same-origin navigation");
foreach (var invalid in new[]
{
    "http://127.0.0.1:45679/", "https://127.0.0.1:45678/", "http://localhost:45678/",
    "http://user@127.0.0.1:45678/", "file:///C:/example", "javascript:alert(1)", "tandem:run"
})
    Check(!SecurityPolicy.IsTrusted(origin, invalid), "reject top-level navigation: " + invalid);
Check(SecurityPolicy.TryWebAddress("https://example.com/path", out _), "external HTTPS");
Check(!SecurityPolicy.TryWebAddress("https://user:secret@example.com/", out _), "reject URL credentials");

foreach (var secret in new[]
{
    "Authorization: Bearer test-secret", "Authorization: Basic test-secret",
    """{"access_token":"test-secret"}""", "client_secret=test-secret", "token=test-secret;more-secret",
    "Bearer test-secret"
})
{
    var sanitized = DiagnosticLog.Sanitize(secret);
    Check(!sanitized.Contains("test-secret") && !sanitized.Contains("more-secret"), "redact diagnostic token");
}

void CheckPermissionDialogs()
{
    using (var dialog = new PermissionDialog("Open an external link?", "https://example.com", "Open browser"))
    {
        var buttons = dialog.Controls.OfType<TableLayoutPanel>().Single()
            .Controls.OfType<FlowLayoutPanel>().Single().Controls.OfType<Button>().ToArray();
        var deny = buttons.Single(button => button.Text == "Deny");
        Check(deny.DialogResult == DialogResult.Cancel && dialog.AcceptButton == deny && dialog.CancelButton == deny,
            "browser consent defaults and Escape remain deny");
        Check(buttons.Length == 2 && buttons.Single(button => button.Text == "Open browser").DialogResult == DialogResult.OK,
            "non-Copilot native consent preserves its original actions");
    }
    using (var dialog = new PermissionDialog("Allow shell action?", "Get-ChildItem", canAllowAllForSession: true))
    {
        var layout = dialog.Controls.OfType<TableLayoutPanel>().Single();
        var buttons = layout.Controls.OfType<FlowLayoutPanel>().Single().Controls.OfType<Button>().ToArray();
        var deny = buttons.Single(button => button.Text == "Deny");
        Check(dialog.AcceptButton == deny && dialog.CancelButton == deny, "tool consent defaults to deny");
        Check(buttons.Length == 3 &&
            buttons.Single(button => button.Text == "Allow all for this session").DialogResult == DialogResult.Yes &&
            buttons.Single(button => button.Text == "Allow once").DialogResult == DialogResult.OK,
            "tool dialog distinguishes single-request and session approval");
        Check(layout.Controls.OfType<TextBox>().Single().Text.Contains("until the backend restarts"),
            "session scope and automatic execution risk are visible before consent");
    }
    using (var dialog = new PermissionDialog("Managed permission", "Explicit approval required"))
    {
        var buttons = dialog.Controls.OfType<TableLayoutPanel>().Single()
            .Controls.OfType<FlowLayoutPanel>().Single().Controls.OfType<Button>().ToArray();
        Check(buttons.Length == 2 && buttons.All(button => button.DialogResult != DialogResult.Yes),
            "managed-policy and sandbox consent cannot enable allow-all");
    }
    using (var window = new MainForm(DesktopOptions.Parse([])))
    {
        var permissions = window.Controls.OfType<ToolStrip>().SelectMany(strip => strip.Items.OfType<ToolStripDropDownButton>()).Single();
        Check(permissions.Text == "Upstream permissions: Ask each time" && !permissions.Enabled,
            "new windows show Ask each time until a backend reports its mode");
        var modes = permissions.DropDownItems.OfType<ToolStripMenuItem>().ToArray();
        Check(modes.Single(item => item.Text == "Ask each time").Checked &&
            !modes.Single(item => item.Text == "Allow all for this session").Checked,
            "toolbar exposes both modes without saved opt-in");
    }
}
// Keep WinForms' synchronization context out of the async backend checks below.
Exception? dialogError = null;
var dialogThread = new Thread(() =>
{
    try { CheckPermissionDialogs(); }
    catch (Exception error) { dialogError = error; }
});
dialogThread.SetApartmentState(ApartmentState.STA);
dialogThread.Start();
dialogThread.Join();
if (dialogError is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(dialogError).Throw();

var workspace = Path.Combine(AppContext.BaseDirectory, "checks-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(workspace);
var previousHost = Environment.GetEnvironmentVariable("TANDEM_DESKTOP_HOST");
try
{
    Check(DesktopOptions.Parse(["--workspace", workspace]).Workspace == workspace, "parse workspace");
    try
    {
        DesktopOptions.Parse(["--workspace", "relative"]);
        Check(false, "reject relative workspace");
    }
    catch (ArgumentException) { assertions++; }
    try
    {
        DesktopOptions.Parse(["--smoke-test", Path.Combine(workspace, "report.json")]);
        Check(false, "unattended mode requires workspace");
    }
    catch (ArgumentException) { assertions++; }
    var host = Path.Combine(workspace, "host.mjs");
    await File.WriteAllTextAsync(host, """
        import { spawn } from 'node:child_process';
        import { writeFileSync } from 'node:fs';
        import { createInterface } from 'node:readline';
        import { join } from 'node:path';
        if (process.argv[2] !== '--workspace' || process.argv[3] !== process.cwd()) process.exit(12);
        const emit = value => console.log(JSON.stringify(value));
        const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        worker.unref();
        console.log('not-json');
        emit({ type: 'future-event', ignored: true });
        console.error('Authorization: Bearer test-secret');
        emit({ type: 'status', message: `child:${worker.pid}` });
        emit({ type: 'permission', id: 'permission-1', title: 'Consent required',
          details: '{"kind":"shell","command":"private-command-argument-marker"}', canAllowAllForSession: true });
        emit({ type: 'permission-mode', mode: 'ask' });
        emit({ type: 'ready', url: 'http://127.0.0.1:45678/', workspace: process.cwd(), sessionId: 'check' });
        createInterface({ input: process.stdin }).on('line', line => {
          const command = JSON.parse(line);
          if (command.type === 'question-response' && command.id === 'question-1' && command.cancelled === true)
            emit({ type: 'status', message: 'question-cancelled' });
          if (command.type === 'permission-response' && command.id === 'permission-1' && command.approved === false)
            emit({ type: 'status', message: 'permission-denied' });
          if (command.type === 'set-permission-mode' && command.mode === 'allow-all') {
            emit({ type: 'permission-mode', mode: 'allow-all' });
            emit({ type: 'permission-resolved', id: 'permission-1' });
          }
          if (command.type === 'shutdown') {
            writeFileSync(join(process.cwd(), 'shutdown-received'), 'yes');
            process.exit(0);
          }
        });
        """);
    Environment.SetEnvironmentVariable("TANDEM_DESKTOP_HOST", host);
    var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var denied = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var modeChanged = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var permissionResolved = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var childPid = 0;
    var receivedPermissionDetails = false;
    var log = new DiagnosticLog();
    log.SetWorkspace(workspace);
    await using (var backend = new BackendProcess(log))
    {
        backend.MessageReceived += message =>
        {
            if (message.Type == "permission")
            {
                receivedPermissionDetails = message.Details?.Contains("private-command-argument-marker") == true &&
                    message.CanAllowAllForSession == true;
            }
            if (message.Type == "permission-mode" && message.Mode == "allow-all") modeChanged.TrySetResult();
            if (message.Type == "permission-resolved" && message.Id == "permission-1") permissionResolved.TrySetResult();
            if (message.Type == "ready") ready.TrySetResult();
            if (message.Message == "question-cancelled") cancelled.TrySetResult();
            if (message.Message == "permission-denied") denied.TrySetResult();
            if (message.Message?.StartsWith("child:", StringComparison.Ordinal) == true)
                childPid = int.Parse(message.Message["child:".Length..]);
        };
        backend.Start(workspace);
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(15));
        Check(childPid > 0, "backend and owned worker started");
        Check(receivedPermissionDetails, "permission details remain available for native consent");
        Check(await backend.SendAsync(new { type = "question-response", id = "question-1", cancelled = true }),
            "send cancelled question");
        Check(await backend.SendAsync(new { type = "permission-response", id = "permission-1", approved = false }),
            "send permission denial");
        await Task.WhenAll(cancelled.Task, denied.Task).WaitAsync(TimeSpan.FromSeconds(5));
        assertions += 2;
        Check(await backend.SendAsync(new { type = "set-permission-mode", mode = "allow-all" }),
            "send session permission mode command");
        await Task.WhenAll(modeChanged.Task, permissionResolved.Task).WaitAsync(TimeSpan.FromSeconds(5));
        assertions += 2;
        await backend.StopAsync();
        Check(File.Exists(Path.Combine(workspace, "shutdown-received")), "graceful shutdown command");
        await backend.StopAsync();
        assertions++;
    }
    var childStopped = false;
    for (var attempt = 0; attempt < 30 && !childStopped; attempt++)
    {
        try
        {
            using var child = Process.GetProcessById(childPid);
            childStopped = child.HasExited;
        }
        catch (ArgumentException) { childStopped = true; }
        if (!childStopped) await Task.Delay(100);
    }
    Check(childStopped, "job closed the backend's surviving worker");
    var diagnostics = log.Snapshot();
    Check(diagnostics.Contains("malformed backend JSON"), "malformed output diagnostic");
    Check(diagnostics.Contains("unrecognized backend event"), "forward-compatible protocol");
    Check(!diagnostics.Contains("private-command-argument-marker"), "permission details are absent from diagnostics");
    Check(!(await File.ReadAllTextAsync(Path.Combine(workspace, ".tandem", "desktop", "desktop.log")))
        .Contains("private-command-argument-marker"), "permission details are absent from persisted logs");
    Check(diagnostics.Contains("[redacted]") && !diagnostics.Contains("test-secret"), "stderr is redacted");
}
finally
{
    Environment.SetEnvironmentVariable("TANDEM_DESKTOP_HOST", previousHost);
    Directory.Delete(workspace, recursive: true);
}
Console.WriteLine($"Passed {assertions} desktop checks.");
