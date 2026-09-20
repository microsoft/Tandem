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

var workspace = Path.Combine(AppContext.BaseDirectory, "checks-" + Guid.NewGuid().ToString("N"));
const string startupPermission =
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":["register hooks"]}""";
Check(SecurityPolicy.CanApproveSmokeStartupPermission(startupPermission, true, false, false),
    "allow only the exact smoke-test startup permission");
Check(!SecurityPolicy.CanApproveSmokeStartupPermission(startupPermission, false, false, false),
    "interactive mode must prompt even for startup permission");
Check(!SecurityPolicy.CanApproveSmokeStartupPermission(startupPermission, true, true, false),
    "smoke exception ends when the backend becomes ready");
Check(!SecurityPolicy.CanApproveSmokeStartupPermission(startupPermission, true, false, true),
    "smoke exception is allowed only once per backend");
foreach (var invalid in new string?[]
{
    null, "", "not-json", "null", "[]",
    """{"kind":"shell","extensionName":"session:tandem","capabilities":["register hooks"]}""",
    """{"kind":"extension-permission-access","extensionName":"user:tandem","capabilities":["register hooks"]}""",
    """{"kind":"extension-permission-access","extensionName":"session:other","capabilities":["register hooks"]}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":[]}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":["register hooks","shell"]}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":["register hooks","register hooks"]}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":["Register hooks"]}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":"register hooks"}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":[null]}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":["register hooks"],"command":"run"}""",
    """{"kind":"shell","kind":"extension-permission-access","extensionName":"session:tandem","capabilities":["register hooks"]}""",
    """{"kind":"extension-permission-access","extensionName":"session:tandem","capabilities":["register hooks"],}"""
})
    Check(!SecurityPolicy.CanApproveSmokeStartupPermission(invalid, true, false, false),
        "deny malformed or broader smoke permission");
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
          details: '{"kind":"shell","command":"private-command-argument-marker"}' });
        emit({ type: 'ready', url: 'http://127.0.0.1:45678/', workspace: process.cwd(), sessionId: 'check' });
        createInterface({ input: process.stdin }).on('line', line => {
          const command = JSON.parse(line);
          if (command.type === 'question-response' && command.id === 'question-1' && command.cancelled === true)
            emit({ type: 'status', message: 'question-cancelled' });
          if (command.type === 'permission-response' && command.id === 'permission-1' && command.approved === false)
            emit({ type: 'status', message: 'permission-denied' });
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
    var childPid = 0;
    var receivedPermissionDetails = false;
    var log = new DiagnosticLog();
    log.SetWorkspace(workspace);
    await using (var backend = new BackendProcess(log))
    {
        backend.MessageReceived += message =>
        {
            if (message.Type == "permission")
                receivedPermissionDetails = message.Details?.Contains("private-command-argument-marker") == true;
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
