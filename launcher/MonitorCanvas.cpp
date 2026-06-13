#define UNICODE
#define _UNICODE

#include <windows.h>
#include <shellapi.h>
#include <string>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int)
{
    wchar_t executablePath[MAX_PATH];
    if (!GetModuleFileNameW(nullptr, executablePath, MAX_PATH)) {
        MessageBoxW(nullptr, L"Der Programmordner konnte nicht ermittelt werden.",
                    L"MonitorCanvas", MB_OK | MB_ICONERROR);
        return 1;
    }

    std::wstring directory(executablePath);
    const size_t separator = directory.find_last_of(L"\\/");
    if (separator != std::wstring::npos) {
        directory.resize(separator);
    }

    const std::wstring scriptPath = directory + L"\\server.ps1";
    const std::wstring command =
        L"powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden "
        L"-File \"" + scriptPath + L"\" -NoBrowser";

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    startupInfo.dwFlags = STARTF_USESHOWWINDOW;
    startupInfo.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION processInfo{};
    std::wstring mutableCommand = command;
    const BOOL started = CreateProcessW(
        nullptr,
        mutableCommand.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        directory.c_str(),
        &startupInfo,
        &processInfo
    );

    if (!started) {
        MessageBoxW(nullptr,
                    L"Der lokale MonitorCanvas-Dienst konnte nicht gestartet werden.",
                    L"MonitorCanvas", MB_OK | MB_ICONERROR);
        return 1;
    }

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
    Sleep(1800);
    ShellExecuteW(nullptr, L"open", L"http://127.0.0.1:8765", nullptr, nullptr, SW_SHOWNORMAL);
    return 0;
}
