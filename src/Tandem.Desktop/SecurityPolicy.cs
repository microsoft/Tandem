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

}
