using System.Reflection;
using System.Text.Json;

namespace Tandem.Desktop;

internal static class Program
{
    internal static string Version =>
        typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion.Split('+')[0] ?? "development";

    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        try
        {
            Application.Run(new MainForm(DesktopOptions.Parse(args)));
            return Environment.ExitCode;
        }
        catch (Exception ex)
        {
            MessageBox.Show(DiagnosticLog.Sanitize(ex.Message), "Tandem could not start",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal sealed record DesktopOptions(string? Workspace, string? SmokeReport)
{
    internal static DesktopOptions Parse(string[] args)
    {
        string? workspace = null;
        string? report = null;
        for (var i = 0; i < args.Length; i++)
        {
            var option = args[i];
            if ((option != "--workspace" && option != "--smoke-test") || ++i >= args.Length)
                throw new ArgumentException("Usage: Tandem.Desktop.exe [--workspace <absolute-folder>] " +
                    "[--smoke-test <absolute-report-path>]");
            if (!Path.IsPathFullyQualified(args[i]))
                throw new ArgumentException($"{option} requires an absolute path.");
            var path = Path.GetFullPath(args[i]);
            if (option == "--workspace")
            {
                if (workspace is not null) throw new ArgumentException("--workspace was specified twice.");
                workspace = path;
            }
            else
            {
                if (report is not null) throw new ArgumentException("--smoke-test was specified twice.");
                report = path;
            }
        }
        if (report is not null && workspace is null)
            throw new ArgumentException("--smoke-test requires --workspace for unattended verification.");
        return new DesktopOptions(workspace, report);
    }
}

internal static class WorkspacePreferences
{
    internal static string AppData => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tandem");

    internal static string? Read(Action<string> report)
    {
        try
        {
            var path = JsonSerializer.Deserialize<string>(
                File.ReadAllText(Path.Combine(AppData, "last-workspace.json")));
            if (path is not null && Path.IsPathFullyQualified(path) && Directory.Exists(path)) return path;
            report("The remembered workspace is unavailable; choose a workspace folder.");
            return null;
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            report("Could not read the remembered workspace: " + ex.Message);
            return null;
        }
    }

    internal static void Save(string workspace, Action<string> report)
    {
        try
        {
            Directory.CreateDirectory(AppData);
            File.WriteAllText(Path.Combine(AppData, "last-workspace.json"), JsonSerializer.Serialize(workspace));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            report("Could not remember this workspace: " + ex.Message);
        }
    }
}
