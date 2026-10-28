export function commandJourney({ escaped = false } = {}) {
  const semicolon = escaped ? '#59;' : ';';
  return {
    schemaVersion: 'artifact/v1', format: 'mermaid', id: 'command-journey',
    title: 'Run, inspect, correct and retry', category: 'user-story', width: 950, height: 620,
    source: `sequenceDiagram
    actor User
    participant CLI as Node CLI
    User->>CLI: Invoke with one duration argument
    CLI->>CLI: Check count, ASCII digits and safe integer range
    alt Valid argument
        CLI-->>User: stdout MM:SS plus newline${semicolon} exit 0
        Note over User,CLI: Total minutes do not wrap${semicolon} seconds have two digits
        Note over User,CLI: Minutes have at least two digits${semicolon} 5 seconds becomes 00:05
    else Invalid argument
        CLI-->>User: Short stderr diagnostic${semicolon} empty stdout${semicolon} exit 2
        User->>CLI: Correct arguments and invoke again
        CLI-->>User: Valid retry returns formatted duration and exit 0
    end`,
  };
}
