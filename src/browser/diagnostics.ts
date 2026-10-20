export function redactDiagnostic(message: string): string {
    return message
        .replace(/(authorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token)\s+)?|bearer\s+|(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|secret|password|token)\s*["']?\s*[:=]\s*["']?)[^\s"',]+/gi, "$1[redacted]")
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[redacted]")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .slice(0, 8192);
}
