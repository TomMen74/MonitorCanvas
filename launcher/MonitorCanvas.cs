using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class MonitorCanvasLauncher
{
    private const string ApplicationUrl = "http://127.0.0.1:8765";
    private const string HealthUrl = ApplicationUrl + "/api/monitors";
    private const string MutexName = @"Local\MonitorCanvas.LocalService";

    [STAThread]
    private static void Main()
    {
        if (IsServiceReady())
        {
            OfferToOpenRunningApplication();
            return;
        }

        bool ownsMutex;
        using (var singleInstance = new Mutex(true, MutexName, out ownsMutex))
        {
            if (!ownsMutex)
            {
                WaitUntilReady();
                OfferToOpenRunningApplication();
                return;
            }

            if (IsServiceReady())
            {
                OfferToOpenRunningApplication();
                return;
            }

            StartApplication();
        }
    }

    private static void StartApplication()
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
            WaitUntilReady();
            OpenApplication();
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

    private static void WaitUntilReady()
    {
        for (int attempt = 0; attempt < 40; attempt++)
        {
            if (IsServiceReady())
            {
                return;
            }
            Thread.Sleep(250);
        }

        throw new InvalidOperationException(
            "Der lokale Dienst antwortet nicht. Bitte MonitorCanvas erneut starten."
        );
    }

    private static bool IsServiceReady()
    {
        try
        {
            var request = WebRequest.Create(HealthUrl);
            request.Timeout = 500;
            using (request.GetResponse())
            {
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void OfferToOpenRunningApplication()
    {
        DialogResult result = MessageBox.Show(
            "MonitorCanvas läuft bereits.\n\nSoll die Anwendung im Browser geöffnet werden?",
            "MonitorCanvas",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Information
        );
        if (result == DialogResult.Yes)
        {
            OpenApplication();
        }
    }

    private static void OpenApplication()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = ApplicationUrl,
            UseShellExecute = true
        });
    }
}
