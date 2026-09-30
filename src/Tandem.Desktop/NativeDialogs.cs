namespace Tandem.Desktop;

internal sealed class PermissionDialog : Form
{
    internal PermissionDialog(string title, string details, string allowText = "Allow once", bool canAllowAllForSession = false)
    {
        Text = "Tandem — " + title;
        StartPosition = FormStartPosition.CenterParent;
        MinimumSize = new Size(540, 360);
        Size = new Size(660, 470);
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 1,
            RowCount = 3
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label
        {
            Text = title, AutoSize = true, MaximumSize = new Size(900, 100),
            Margin = new Padding(0, 0, 0, 12)
        }, 0, 0);
        layout.Controls.Add(new TextBox
        {
            Text = canAllowAllForSession
                ? "Allow all for this session permits tool actions, including commands, file changes and network access, " +
                  "until the backend restarts or you select Ask each time. Managed-policy and sandbox consent remain separate.\r\n\r\n" + details
                : details,
            Multiline = true, ReadOnly = true, Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window, TabStop = false
        }, 0, 1);
        var buttons = new FlowLayoutPanel
        {
            AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 12, 0, 0)
        };
        var deny = new Button { Text = "Deny", DialogResult = DialogResult.Cancel, AutoSize = true };
        var allow = new Button { Text = allowText, DialogResult = DialogResult.OK, AutoSize = true };
        buttons.Controls.Add(deny);
        buttons.Controls.Add(allow);
        if (canAllowAllForSession)
            buttons.Controls.Add(new Button
            {
                Text = "Allow all for this session", DialogResult = DialogResult.Yes, AutoSize = true
            });
        layout.Controls.Add(buttons, 0, 2);
        Controls.Add(layout);
        AcceptButton = deny;
        CancelButton = deny;
    }
}

internal sealed class QuestionDialog : Form
{
    private readonly ListBox _choices = new() { Dock = DockStyle.Fill, IntegralHeight = false };
    private readonly TextBox _answer = new()
    {
        Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Vertical,
        MaxLength = 32 * 1024, AcceptsReturn = true
    };
    private readonly RadioButton _choose = new() { Text = "Choose an answer", AutoSize = true };
    private readonly RadioButton _write = new() { Text = "Write an answer", AutoSize = true };
    internal string Answer => WasFreeform ? _answer.Text.Trim() : _choices.SelectedItem?.ToString() ?? "";
    internal bool WasFreeform => _write.Checked;

    internal QuestionDialog(string question, string[] choices, bool allowFreeform)
    {
        Text = "Tandem — Your input is needed";
        StartPosition = FormStartPosition.CenterParent;
        MinimumSize = new Size(540, 440);
        Size = new Size(660, 560);
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 6
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 110));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, choices.Length == 0 ? 0 : 60));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, allowFreeform ? 40 : 0));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new TextBox
        {
            Text = question, ReadOnly = true, Multiline = true, Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Vertical, BorderStyle = BorderStyle.None,
            BackColor = SystemColors.Control, TabStop = false
        }, 0, 0);
        layout.Controls.Add(_choose, 0, 1);
        layout.Controls.Add(_choices, 0, 2);
        layout.Controls.Add(_write, 0, 3);
        layout.Controls.Add(_answer, 0, 4);
        _choices.Items.AddRange(choices);
        _choose.Visible = _choices.Visible = choices.Length > 0;
        _write.Visible = _answer.Visible = allowFreeform;
        _choose.Checked = choices.Length > 0;
        _write.Checked = choices.Length == 0 && allowFreeform;
        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 12, 0, 0)
        };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        var submit = new Button { Text = "Submit", DialogResult = DialogResult.OK, AutoSize = true };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(submit);
        layout.Controls.Add(buttons, 0, 5);
        Controls.Add(layout);
        CancelButton = cancel;
        AcceptButton = submit;
        void RefreshAnswer(object? sender, EventArgs e)
        {
            _choices.Enabled = _choose.Checked;
            _answer.Enabled = _write.Checked;
            submit.Enabled = _write.Checked ? !string.IsNullOrWhiteSpace(_answer.Text) :
                _choose.Checked && _choices.SelectedIndex >= 0;
        }
        _choose.CheckedChanged += RefreshAnswer;
        _write.CheckedChanged += RefreshAnswer;
        _choices.SelectedIndexChanged += RefreshAnswer;
        _answer.TextChanged += RefreshAnswer;
        RefreshAnswer(null, EventArgs.Empty);
    }
}
