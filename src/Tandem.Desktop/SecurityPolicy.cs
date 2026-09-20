using System.Text.Json;
using System.Text.RegularExpressions;

namespace Tandem.Desktop;

internal static partial class SecurityPolicy
{
    [GeneratedRegex(@"\Ahttp://127\.0\.0\.1:([1-9][0-9]{0,4})/\z", RegexOptions.CultureInvariant)]
    private static partial Regex ReadyAddress();

    internal static bool TryReadyOrigin(string? value, out Uri? origin)
    {
        origin = null;
        if (value is null || value.Length > 64) return false;
        var match = ReadyAddress().Match(value);
        return match.Success && int.TryParse(match.Groups[1].Value, out var port) &&
            port is > 0 and <= 65535 && Uri.TryCreate(value, UriKind.Absolute, out origin);
    }

    internal static bool IsTrusted(Uri? origin, string? value) =>
        origin is not null && TryWebAddress(value, out var uri) &&
        uri!.Scheme == origin.Scheme && uri.Host == origin.Host && uri.Port == origin.Port;

    internal static bool TryWebAddress(string? value, out Uri? uri)
    {
        uri = null;
        return value is not null && value.Length <= 8192 &&
            Uri.TryCreate(value, UriKind.Absolute, out uri) &&
            (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
            string.IsNullOrEmpty(uri.UserInfo);
    }

    internal static bool CanApproveSmokeStartupPermission(
        string? details, bool smokeTest, bool startupComplete, bool alreadyApproved)
    {
        if (!smokeTest || startupComplete || alreadyApproved ||
            string.IsNullOrWhiteSpace(details) || details.Length > 32 * 1024) return false;
        try
        {
            using var document = JsonDocument.Parse(details, new JsonDocumentOptions { MaxDepth = 4 });
            var request = document.RootElement;
            return request.ValueKind == JsonValueKind.Object && request.EnumerateObject().Count() == 3 &&
                request.TryGetProperty("kind", out var kind) && kind.ValueKind == JsonValueKind.String &&
                kind.ValueEquals("extension-permission-access") &&
                request.TryGetProperty("extensionName", out var name) && name.ValueKind == JsonValueKind.String &&
                name.ValueEquals("session:tandem") &&
                request.TryGetProperty("capabilities", out var capabilities) &&
                capabilities.ValueKind == JsonValueKind.Array && capabilities.GetArrayLength() == 1 &&
                capabilities[0].ValueKind == JsonValueKind.String && capabilities[0].ValueEquals("register hooks");
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
