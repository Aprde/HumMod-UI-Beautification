using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

sealed class StudioWindow : Form {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string id);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    readonly string root=AppDomain.CurrentDomain.BaseDirectory;
    readonly string dataRoot;
    readonly string origin;
    readonly bool smoke;
    readonly WebView2 web=new WebView2();
    readonly Label loading=new Label();
    IntPtr largeIcon=IntPtr.Zero,smallIcon=IntPtr.Zero;

    [STAThread] static int Main(string[] args) {
        SetCurrentProcessExplicitAppUserModelID("Aprde.HumModUIBeautification");
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using(var window=new StudioWindow(Array.IndexOf(args,"--smoke-test")>=0)) Application.Run(window);
        return Environment.ExitCode;
    }
    public StudioWindow(bool smokeTest) {
        smoke=smokeTest;
        dataRoot=Environment.GetEnvironmentVariable("HUMMOD_DESKTOP_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"HumMod UI Beautification");
        int port; if(!int.TryParse(Environment.GetEnvironmentVariable("HUMMOD_UI_PORT"),out port)||port<1024||port>65535)port=4318;
        origin="http://127.0.0.1:"+port;
        Directory.CreateDirectory(dataRoot);
        Text="HumMod Studio";
        AutoScaleMode=AutoScaleMode.Dpi;
        ClientSize=new Size(1440,900);
        MinimumSize=new Size(850,650);
        StartPosition=FormStartPosition.CenterScreen;
        WindowState=FormWindowState.Maximized;
        BackColor=Color.FromArgb(244,244,243);
        string icon=Path.Combine(root,"app","assets","hummod.ico");
        if(File.Exists(icon))Icon=new Icon(icon,new Size(256,256));
        web.Dock=DockStyle.Fill;
        web.DefaultBackgroundColor=BackColor;
        loading.Text="Opening your workspace…";
        loading.Dock=DockStyle.Fill;
        loading.TextAlign=ContentAlignment.MiddleCenter;
        loading.Font=new Font("Segoe UI",14);
        Controls.Add(web);Controls.Add(loading);
        Shown+=async delegate { await OpenWorkspace(); };
    }
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);ApplyIcons();}
    protected override void WndProc(ref Message m){base.WndProc(ref m);if(m.Msg==0x02E0)ApplyIcons();}
    void ApplyIcons(){
        string file=Path.Combine(root,"app","assets","hummod.ico");if(!File.Exists(file))return;
        uint dpi=96;try{dpi=GetDpiForWindow(Handle);}catch(EntryPointNotFoundException){}
        int large=(int)Math.Round(32*dpi/96.0),small=(int)Math.Round(16*dpi/96.0);
        IntPtr nextLarge=LoadImage(IntPtr.Zero,file,1,large,large,0x10),nextSmall=LoadImage(IntPtr.Zero,file,1,small,small,0x10);
        if(nextLarge!=IntPtr.Zero){SendMessage(Handle,0x80,(IntPtr)1,nextLarge);if(largeIcon!=IntPtr.Zero)DestroyIcon(largeIcon);largeIcon=nextLarge;}
        if(nextSmall!=IntPtr.Zero){SendMessage(Handle,0x80,IntPtr.Zero,nextSmall);if(smallIcon!=IntPtr.Zero)DestroyIcon(smallIcon);smallIcon=nextSmall;}
    }
    async Task<bool> IsReady(){
        try{using(var client=new HttpClient()){client.Timeout=TimeSpan.FromSeconds(2);return (await client.GetStringAsync(origin)).Contains("name=\"hummod-token\"");}}catch{return false;}
    }
    async Task OpenWorkspace(){
        try {
            if(!await IsReady()){
                string node=Path.Combine(root,"runtime","node.exe"),server=Path.Combine(root,"app","server.mjs");
                if(!File.Exists(node)||!File.Exists(server))throw new Exception("The application folder is incomplete. Extract the entire release ZIP before opening HumMod Studio.exe.");
                var start=new ProcessStartInfo(node,"\""+server+"\""){WorkingDirectory=Path.GetDirectoryName(server),UseShellExecute=false,CreateNoWindow=true};
                start.EnvironmentVariables["HUMMOD_CONFIG_DIR"]=Path.Combine(dataRoot,"workspace-state");
                start.EnvironmentVariables["HUMMOD_SESSION_DIR"]=Path.Combine(dataRoot,"sessions");
                start.EnvironmentVariables["HUMMOD_ENGINE_DIR"]=Path.Combine(dataRoot,"legacy-engine");
                start.EnvironmentVariables["HUMMOD_PROJECTS_HOME"]=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),"HumMod Experiments");
                start.EnvironmentVariables["HUMMOD_UI_PORT"]=new Uri(origin).Port.ToString();
                var process=Process.Start(start);
                File.WriteAllText(Path.Combine(dataRoot,"server.pid"),process.Id.ToString());
                for(int i=0;i<120&&!await IsReady();i++){if(process.HasExited)throw new Exception("The local workspace service could not start.");await Task.Delay(500);}
                if(!await IsReady())throw new Exception("The workspace took too long to start. Please reopen the application.");
            }
            var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(dataRoot,"browser"));
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.Settings.IsStatusBarEnabled=false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
            web.CoreWebView2.NavigationStarting+=delegate(object sender,CoreWebView2NavigationStartingEventArgs e){
                Uri target;if(Uri.TryCreate(e.Uri,UriKind.Absolute,out target)&&target.GetLeftPart(UriPartial.Authority)!=origin&&e.Uri!="about:blank"){e.Cancel=true;OpenExternal(e.Uri);}
            };
            web.CoreWebView2.NewWindowRequested+=delegate(object sender,CoreWebView2NewWindowRequestedEventArgs e){e.Handled=true;OpenExternal(e.Uri);};
            web.CoreWebView2.NavigationCompleted+=async delegate(object sender,CoreWebView2NavigationCompletedEventArgs e){
                loading.Visible=false;
                if(smoke){
                    if(!e.IsSuccess){Environment.ExitCode=1;Close();return;}
                    bool ready=false;for(int i=0;i<120;i++){await Task.Delay(500);if(await web.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('.dashboard') && document.fonts.status === 'loaded'")=="true"){ready=true;break;}}
                    string report=await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify({title:document.title,language:document.documentElement.lang,heading:document.querySelector('h1')?.innerText,setup:!!document.querySelector('#engine-path'),overflow:document.documentElement.scrollWidth>innerWidth})");
                    File.WriteAllText(Path.Combine(dataRoot,"desktop-smoke.json"),report);
                    using(var output=File.Create(Path.Combine(dataRoot,"desktop-smoke.png")))await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,output);
                    File.WriteAllText(Path.Combine(dataRoot,"icon-smoke.txt"),"DPI="+GetDpiForWindow(Handle)+"; large="+(largeIcon!=IntPtr.Zero)+"; small="+(smallIcon!=IntPtr.Zero));
                    Environment.ExitCode=ready?0:1;Close();
                }
            };
            web.Source=new Uri(origin);
        } catch(Exception e){
            File.WriteAllText(Path.Combine(dataRoot,"startup-error.txt"),e.ToString());
            if(smoke){Environment.ExitCode=1;Close();return;}
            loading.Text="Unable to open HumMod Studio";
            MessageBox.Show(this,e.Message+"\n\nIf WebView2 is missing, install Microsoft Edge WebView2 Runtime and try again.","HumMod Studio",MessageBoxButtons.OK,MessageBoxIcon.Information);
        }
    }
    static void OpenExternal(string url){Uri target;if(Uri.TryCreate(url,UriKind.Absolute,out target)&&(target.Scheme=="https"||target.Scheme=="http"))Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}
    protected override void Dispose(bool disposing){if(disposing){web.Dispose();loading.Dispose();}base.Dispose(disposing);if(largeIcon!=IntPtr.Zero){DestroyIcon(largeIcon);largeIcon=IntPtr.Zero;}if(smallIcon!=IntPtr.Zero){DestroyIcon(smallIcon);smallIcon=IntPtr.Zero;}}
}
