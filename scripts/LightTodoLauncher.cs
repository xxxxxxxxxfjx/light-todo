using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;
using System.Reflection;
using System.IO.Compression;
using System.ComponentModel;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;

internal static class LightTodoLauncher {
    const string AppVersion = "__LIGHTTODO_VERSION__";
    static readonly string PortableRoot = Environment.GetEnvironmentVariable("PORTABLE_EXECUTABLE_DIR") ?? AppDomain.CurrentDomain.BaseDirectory;
    static string LogPath;
    static void TryLog(string message) {
        // Diagnostics must never prevent starting or retrying the application.
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
            File.AppendAllText(LogPath, DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
        } catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        catch (System.Security.SecurityException) { }
    }
    static string ResolveRuntime() {
        string payloadName = null;
        foreach (string name in Assembly.GetExecutingAssembly().GetManifestResourceNames())
            if (name.StartsWith("LightTodo.Payload.", StringComparison.Ordinal)) payloadName = name;
        if (payloadName == null) return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "LightTodoRuntime.exe");
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(payloadName)) {
            if (payload == null) return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "LightTodoRuntime.exe");
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string target = Path.Combine(root, "LightTodoApp-" + AppVersion + "-" + payloadName.Split('.')[2]);
            string entryPoint = Path.Combine(target, "LightTodo.exe");
            if (!File.Exists(Path.Combine(target, ".complete"))) {
                // Extract beside the portable exe, avoiding restricted Windows temporary directories.
                string staging = Path.Combine(root, ".LightTodo-extract-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(staging);
                using (var zip = new ZipArchive(payload, ZipArchiveMode.Read)) {
                    foreach (var entry in zip.Entries) {
                        string destination = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                        if (!destination.StartsWith(staging + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("无效的程序包路径");
                        if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(destination); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        using (var input = entry.Open()) using (var output = File.Create(destination)) input.CopyTo(output);
                    }
                }
                File.WriteAllText(Path.Combine(staging, ".complete"), AppVersion);
                if (!Directory.Exists(target)) Directory.Move(staging, target);
                else throw new IOException("程序目录不完整，请将 " + Path.GetFileName(target) + " 文件夹重命名后重试。");
            }
            return entryPoint;
        }
    }
    static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            slashes = 0; result.Append(c);
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
    static int Run(string runtime, string arguments) {
        // Create the child suspended, then put it in a kill-on-close job before
        // it can create Electron renderers or another launcher. Windows closes
        // this handle even when this launcher is forcibly terminated.
        using (var job = new ChildProcessJob()) {
            var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables()) environment[(string)entry.Key] = (string)entry.Value;
            environment.Remove("ELECTRON_RUN_AS_NODE");
            environment.Remove("NODE_OPTIONS");
            environment["PORTABLE_EXECUTABLE_DIR"] = PortableRoot;
            var block = new StringBuilder();
            foreach (var entry in environment) block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
            block.Append('\0');
            IntPtr environmentBlock = Marshal.StringToHGlobalUni(block.ToString());
            var startup = new Native.StartupInfo();
            startup.Size = Marshal.SizeOf(typeof(Native.StartupInfo));
            var process = new Native.ProcessInfo();
            try {
                if (!Native.CreateProcess(runtime, new StringBuilder(Quote(runtime) + " " + arguments), IntPtr.Zero, IntPtr.Zero, false,
                    0x00000004 | 0x00000400, environmentBlock, AppDomain.CurrentDomain.BaseDirectory, ref startup, out process)) throw new Win32Exception(Marshal.GetLastWin32Error());
                try {
                    job.Assign(process.Process);
                    if (Native.ResumeThread(process.Thread) == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
                } catch { Native.TerminateProcess(process.Process, 1); throw; }
                if (Native.WaitForSingleObject(process.Process, UInt32.MaxValue) != 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                uint exitCode;
                if (!Native.GetExitCodeProcess(process.Process, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error());
                return unchecked((int)exitCode);
            } finally {
                if (process.Thread != IntPtr.Zero) Native.CloseHandle(process.Thread);
                if (process.Process != IntPtr.Zero) Native.CloseHandle(process.Process);
                Marshal.FreeHGlobal(environmentBlock);
            }
        }
    }

    sealed class ChildProcessJob : IDisposable {
        IntPtr handle;
        public ChildProcessJob() {
            handle = Native.CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            var limits = new Native.ExtendedLimitInformation();
            limits.Basic.LimitFlags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!Native.SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(Native.ExtendedLimitInformation)))) {
                int error = Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error);
            }
        }
        public void Assign(IntPtr process) {
            if (!Native.AssignProcessToJobObject(handle, process)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public void Dispose() { if (handle != IntPtr.Zero) { Native.CloseHandle(handle); handle = IntPtr.Zero; } }
    }

    static class Native {
        [StructLayout(LayoutKind.Sequential)] public struct BasicLimitInformation {
            public long ProcessTime, JobTime;
            public uint LimitFlags;
            public UIntPtr MinWorkingSet, MaxWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] public struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimitInformation {
            public BasicLimitInformation Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct StartupInfo {
            public int Size;
            public string Reserved, Desktop, Title;
            public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
            public ushort ShowWindow, ReservedSize;
            public IntPtr ReservedData, StdInput, StdOutput, StdError;
        }
        [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref ExtendedLimitInformation information, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr handle);
    }
    [STAThread] static int Main(string[] args) {
        string logDir = Environment.GetEnvironmentVariable("LIGHTTODO_DATA_DIR");
        if (String.IsNullOrEmpty(logDir)) logDir = Path.Combine(PortableRoot, "LightTodoData");
        string log = Path.Combine(logDir, "launcher.log");
        LogPath = log;
        try {
            string runtime = ResolveRuntime();
            if (!File.Exists(runtime)) throw new FileNotFoundException("请完整解压程序目录后再运行轻单。", runtime);
            var arguments = new StringBuilder();
            foreach (string arg in args) { arguments.Append(Quote(arg)); arguments.Append(' '); }
            int code = Run(runtime, arguments.ToString());
            TryLog("exit=" + code);
            // 0x80000003：Chromium 在受限/远程会话里初始化失败。自动降级重试一次，
            // 让用户双击 exe 也能起来，而不是只留一行退出码。
            if (code == unchecked((int)0x80000003) && arguments.ToString().IndexOf("--no-sandbox", StringComparison.OrdinalIgnoreCase) < 0) {
                TryLog("retry with --no-sandbox --disable-gpu");
                code = Run(runtime, arguments.ToString() + "--no-sandbox --disable-gpu ");
                TryLog("exit-retry=" + code);
            }
            return code;
        } catch (Exception error) {
            MessageBox.Show(error.Message + "\n日志：" + log, "轻单启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
