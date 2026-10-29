using System.Text;
using System.Text.RegularExpressions;

namespace Tandem.Desktop;

internal sealed partial class DiagnosticLog
{
    private readonly object _sync = new();
    private readonly Queue<string> _recent = new();
    private string? _file;
    internal event Action? Changed;

    [GeneratedRegex(@"(?i)(authorization[""']?\s*[:=]\s*[""']?(?:(?:bearer|basic|token)\s+)?|bearer\s+|(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|secret|password|token)\s*[""']?\s*[:=]\s*[""']?)[^\s""',]+", RegexOptions.CultureInvariant)]
    private static partial Regex NamedSecrets();

    [GeneratedRegex(@"\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b", RegexOptions.CultureInvariant)]
    private static partial Regex TokenShapes();

    internal static string Sanitize(string value)
    {
        var clean = TokenShapes().Replace(NamedSecrets().Replace(value, "$1[redacted]"), "[redacted]");
        clean = new string(clean.Where(c => !char.IsControl(c) || c is '\r' or '\n' or '\t').ToArray());
        return clean.Length <= 8192 ? clean : clean[..8192] + " [truncated]";
    }

    internal void SetWorkspace(string workspace)
    {
        lock (_sync)
        {
            _file = null;
            _recent.Clear();
            try
            {
                var directory = Path.Combine(workspace, ".tandem", "desktop");
                Directory.CreateDirectory(directory);
                _file = Path.Combine(directory, "desktop.log");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                _recent.Enqueue("Diagnostic file unavailable; this window still keeps recent messages: " + Sanitize(ex.Message));
            }
        }
    }

    internal void Write(string message)
    {
        var line = $"{DateTimeOffset.Now:O} {Sanitize(message)}";
        lock (_sync)
        {
            _recent.Enqueue(line);
            while (_recent.Count > 150) _recent.Dequeue();
            if (_file is not null)
            {
                try
                {
                    if (File.Exists(_file) && new FileInfo(_file).Length > 512 * 1024)
                        File.Move(_file, _file + ".previous", true);
                    File.AppendAllText(_file, line + Environment.NewLine, Encoding.UTF8);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    _file = null;
                    _recent.Enqueue("Diagnostic file unavailable; this window still keeps recent messages: " + Sanitize(ex.Message));
                }
            }
        }
        Changed?.Invoke();
    }

    internal string Snapshot()
    {
        lock (_sync) return string.Join(Environment.NewLine, _recent);
    }
}
