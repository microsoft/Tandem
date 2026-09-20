using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Tandem.Desktop;

internal sealed record BackendEvent
{
    public string? Type { get; init; }
    public string? Message { get; init; }
    public string? Url { get; init; }
    public string? Workspace { get; init; }
    public string? SessionId { get; init; }
    public string? Id { get; init; }
    public string? Title { get; init; }
    public string? Details { get; init; }
    public string? Question { get; init; }
    public string[]? Choices { get; init; }
    public bool? AllowFreeform { get; init; }
}

internal sealed class BackendProcess : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        MaxDepth = 16
    };
    private readonly Process _process = new();
    private readonly DiagnosticLog _log;
    private readonly CancellationTokenSource _readCancellation = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly object _stopLock = new();
    private WindowsJob? _job;
    private Task _readers = Task.CompletedTask;
    private Task? _stopTask;
    private bool _started;

    internal event Action<BackendEvent>? MessageReceived;
    internal event Action<int>? Exited;
    internal bool IsStopping { get; private set; }

    internal BackendProcess(DiagnosticLog log) => _log = log;

    internal void Start(string workspace)
    {
        var host = Environment.GetEnvironmentVariable("TANDEM_DESKTOP_HOST");
        if (string.IsNullOrWhiteSpace(host))
            host = Path.Combine(AppContext.BaseDirectory, "runtime", "host.mjs");
        if (!Path.IsPathFullyQualified(host) || !File.Exists(host))
            throw new FileNotFoundException(
                "The desktop backend is missing. Build the desktop package, or set TANDEM_DESKTOP_HOST " +
                "to the absolute path of its runtime\\host.mjs file.", host);

        var bundledNode = Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe");
        var node = File.Exists(bundledNode) ? bundledNode : FindNode();
        var start = new ProcessStartInfo(node)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            WorkingDirectory = workspace
        };
        start.ArgumentList.Add(host);
        start.ArgumentList.Add("--workspace");
        start.ArgumentList.Add(workspace);
        _process.StartInfo = start;
        _job = WindowsJob.Create();
        try
        {
            if (!_process.Start()) throw new InvalidOperationException("Node did not start.");
            _started = true;
            _job.Assign(_process);
            _process.Exited += OnExited;
            _process.EnableRaisingEvents = true;
            _readers = Task.WhenAll(
                PumpLinesAsync(_process.StandardOutput, 64 * 1024, ReceiveLine, _readCancellation.Token),
                PumpLinesAsync(_process.StandardError, 8192,
                    line => _log.Write("Backend: " + line), _readCancellation.Token));
        }
        catch (Exception ex)
        {
            KillOwnedProcess();
            _job.Dispose();
            if (ex is Win32Exception { NativeErrorCode: 2 or 3 })
                throw new InvalidOperationException(
                    "Node.js could not be found. Install Node.js, bundle runtime\\node.exe, or set " +
                    "TANDEM_NODE_PATH to node.exe, then retry.", ex);
            throw;
        }
    }

    private static string FindNode()
    {
        var configured = Environment.GetEnvironmentVariable("TANDEM_NODE_PATH");
        if (!string.IsNullOrWhiteSpace(configured))
        {
            if (!Path.IsPathFullyQualified(configured) || !File.Exists(configured))
                throw new FileNotFoundException("TANDEM_NODE_PATH must point to an existing absolute node.exe path.");
            return configured;
        }
        foreach (var entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            var directory = entry.Trim().Trim('"');
            if (!Path.IsPathFullyQualified(directory)) continue;
            var candidate = Path.Combine(directory, "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException(
            "Node.js could not be found on PATH. Install Node.js, bundle runtime\\node.exe, " +
            "or set TANDEM_NODE_PATH to its absolute path, then retry.");
    }

    private void OnExited(object? sender, EventArgs args)
    {
        // The backend may exit while one of its workers is still running.
        _job?.Dispose();
        try { Exited?.Invoke(_process.ExitCode); }
        catch (InvalidOperationException) { }
    }

    private void ReceiveLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        try
        {
            var message = JsonSerializer.Deserialize<BackendEvent>(line, JsonOptions);
            if (message?.Type is null)
            {
                _log.Write("Ignored a backend event with no type.");
                return;
            }
            switch (message.Type)
            {
                case "status":
                case "ready":
                case "error":
                case "permission":
                case "question":
                case "stopped":
                    if (message.Type == "error") _log.Write("Backend error: " + message.Message);
                    MessageReceived?.Invoke(message);
                    break;
                default:
                    _log.Write("Ignored an unrecognized backend event type.");
                    break;
            }
        }
        catch (JsonException)
        {
            _log.Write("Ignored malformed backend JSON (payload not logged).");
        }
    }

    private async Task PumpLinesAsync(StreamReader reader, int limit, Action<string> receive, CancellationToken token)
    {
        var buffer = new char[4096];
        var line = new StringBuilder();
        var oversized = false;
        try
        {
            int read;
            while ((read = await reader.ReadAsync(buffer.AsMemory(), token).ConfigureAwait(false)) > 0)
            {
                for (var i = 0; i < read; i++)
                {
                    var c = buffer[i];
                    if (c == '\n')
                    {
                        if (!oversized) receive(line.ToString().TrimEnd('\r'));
                        line.Clear();
                        oversized = false;
                    }
                    else if (!oversized)
                    {
                        if (line.Length >= limit)
                        {
                            oversized = true;
                            line.Clear();
                            _log.Write("Ignored an oversized backend output line.");
                        }
                        else line.Append(c);
                    }
                }
            }
            if (line.Length > 0 && !oversized) receive(line.ToString());
        }
        catch (Exception ex) when (ex is IOException or OperationCanceledException or ObjectDisposedException)
        {
            if (!token.IsCancellationRequested) _log.Write("Backend output stream closed.");
        }
    }

    internal async Task<bool> SendAsync(object command, CancellationToken token = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        var acquired = false;
        try
        {
            await _writeGate.WaitAsync(timeout.Token).ConfigureAwait(false);
            acquired = true;
            if (!_started || _process.HasExited) return false;
            await _process.StandardInput.WriteLineAsync(
                JsonSerializer.Serialize(command, JsonOptions).AsMemory(), timeout.Token).ConfigureAwait(false);
            await _process.StandardInput.FlushAsync(timeout.Token).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or OperationCanceledException)
        {
            _log.Write("A response could not be delivered to the backend.");
            return false;
        }
        finally
        {
            if (acquired) _writeGate.Release();
        }
    }

    internal Task StopAsync()
    {
        lock (_stopLock) return _stopTask ??= StopCoreAsync();
    }

    private async Task StopCoreAsync()
    {
        IsStopping = true;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        try
        {
            if (_started && !_process.HasExited)
            {
                await SendAsync(new { type = "shutdown" }, timeout.Token).ConfigureAwait(false);
                await _process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            _log.Write("Backend shutdown timed out; terminating only the owned backend process tree.");
            KillOwnedProcess();
        }
        finally
        {
            _job?.Dispose();
            _readCancellation.Cancel();
            await _readers.ConfigureAwait(false);
        }
    }

    private void KillOwnedProcess()
    {
        try
        {
            if (_started && !_process.HasExited) _process.Kill(entireProcessTree: true);
        }
        catch (Exception ex) when (ex is InvalidOperationException or Win32Exception)
        {
            _log.Write("Process cleanup is completing through the owned Windows job.");
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync().ConfigureAwait(false);
        _process.Exited -= OnExited;
        _process.Dispose();
        _readCancellation.Dispose();
        // Pending native dialogs may still finish their asynchronous response writes.
    }
}
