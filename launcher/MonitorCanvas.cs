using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal static class MonitorCanvasLauncher
{
    [STAThread]
    private static void Main()
    {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        string scriptPath = Path.Combine(directory, "server.ps1");

        if (!File.Exists(scriptPath))
        {
            MessageBox.Show(
                "Die Datei server.ps1 wurde nicht gefunden.",
                "MonitorCanvas",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return;
        }

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments =
                    "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " +
                    "-File \"" + scriptPath + "\" -NoBrowser",
                WorkingDirectory = directory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            Process.Start(startInfo);
            Thread.Sleep(1800);
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:8765",
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "MonitorCanvas konnte nicht gestartet werden.\n\n" + error.Message,
                "MonitorCanvas",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
