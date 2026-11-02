using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Threading;

class NativeBridge {
 delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr x);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr x);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,StringBuilder s,uint flags,uint ms,out IntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendText(IntPtr h,uint m,IntPtr w,string s,uint flags,uint ms,out IntPtr result);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr h,int p);
 [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr h,int p);
 [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr h,uint p,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr h,uint p,StringBuilder s,int n,uint flags);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] static extern bool GetScrollRange(IntPtr h,int bar,out int min,out int max);
 [DllImport("user32.dll")] static extern int GetScrollPos(IntPtr h,int bar);
 [DllImport("user32.dll")] static extern int SetScrollPos(IntPtr h,int bar,int pos,bool redraw);
 [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h,int index);
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 static string Text(IntPtr h) {var s=new StringBuilder(65536); IntPtr result;SendMessageTimeout(h,13,(IntPtr)s.Capacity,s,2,1000,out result);return s.ToString();}
 static string Class(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,s.Capacity);return s.ToString();}
 static List<IntPtr> Windows(int pid){var list=new List<IntPtr>();EnumWindows(delegate(IntPtr h,IntPtr p){uint id;GetWindowThreadProcessId(h,out id);if(id==pid)list.Add(h);return true;},IntPtr.Zero);return list;}
 static List<IntPtr> Children(IntPtr h){var list=new List<IntPtr>();EnumChildWindows(h,delegate(IntPtr c,IntPtr p){list.Add(c);return true;},IntPtr.Zero);return list;}
 static void Navigate(IntPtr main,uint id){if(id<31||id>65534)throw new Exception("Invalid model page command");if(!IsWindowEnabled(main))throw new Exception("Engine has an open modal dialog");IntPtr result;if(SendText(main,0x111,(IntPtr)id,null,2,30000,out result)==IntPtr.Zero)throw new Exception("Model page did not finish loading");}
 static object Info(IntPtr h){Rect r;GetWindowRect(h,out r);int min=0,max=0; if(Class(h)=="ScrollBar")GetScrollRange(h,2,out min,out max); return new {handle=h.ToInt64(),id=GetDlgCtrlID(h),type=Class(h),text=Text(h),visible=IsWindowVisible(h),enabled=IsWindowEnabled(h),style=GetWindowLong(h,-16),position=Class(h)=="ScrollBar"?GetScrollPos(h,2):0,min=min,max=max,bounds=new[]{r.left,r.top,r.right,r.bottom}};}
 static IntPtr WaitDialog(int pid){for(int i=0;i<100;i++){var d=Windows(pid).Where(h=>Class(h)=="#32770"&&IsWindowVisible(h)).ToArray();if(d.Length==1)return d[0];if(d.Length>1)throw new Exception("Unexpected multiple dialogs");Thread.Sleep(50);}throw new Exception("File dialog did not open");}
 static void Save(int pid,IntPtr main,string file,int command){
  file=Path.GetFullPath(file); if(File.Exists(file))throw new Exception("Export target already exists");
  if(!IsWindowEnabled(main))throw new Exception("Engine busy or modal is open");
  PostMessage(main,0x111,(IntPtr)command,IntPtr.Zero);
  var dialog=WaitDialog(pid);IntPtr[] edits=new IntPtr[0],buttons=new IntPtr[0];
  for(int ready=0;ready<600;ready++){dialog=Windows(pid).FirstOrDefault(h=>Class(h)=="#32770"&&IsWindowVisible(h));var children=Children(dialog);edits=children.Where(h=>Class(h)=="Edit"&&(GetDlgCtrlID(h)==1001||GetDlgCtrlID(h)==1148)&&IsWindowVisible(h)).ToArray();buttons=children.Where(h=>Class(h)=="Button"&&GetDlgCtrlID(h)==1&&IsWindowVisible(h)&&IsWindowEnabled(h)).ToArray();if(edits.Length==1&&buttons.Length==1)break;Thread.Sleep(50);}
  if(edits.Length!=1||buttons.Length!=1)throw new Exception("Unrecognized file dialog; inspect original engine");
  if(!IsWindowVisible(main))ShowWindow(dialog,0);
  IntPtr result;if(SendText(edits[0],12,IntPtr.Zero,file,2,2000,out result)==IntPtr.Zero)throw new Exception("File name update failed");
  PostMessage(buttons[0],0xF5,IntPtr.Zero,IntPtr.Zero);
  for(int i=0;i<200;i++){if(File.Exists(file)&&IsWindowEnabled(main)){try{using(var f=File.Open(file,FileMode.Open,FileAccess.Read,FileShare.None)){if(f.Length>0)return;}}catch(IOException){}}Thread.Sleep(50);}throw new Exception("Export not completed; inspect original engine");
 }
 static List<object> Menu(IntPtr menu,string prefix){var list=new List<object>(); for(int i=0;i<GetMenuItemCount(menu);i++){var s=new StringBuilder(256);GetMenuString(menu,(uint)i,s,256,0x400);string label=s.ToString().Replace("&","");var sub=GetSubMenu(menu,i);var path=prefix.Length==0?label:prefix+"/"+label;list.Add(new{label=label,path=path,id=GetMenuItemID(menu,i),enabled=(GetMenuState(menu,(uint)i,0x400)&3)==0,children=sub==IntPtr.Zero?new List<object>():Menu(sub,path)});}return list;}
 static void Load(int pid,IntPtr main,string file){
  file=Path.GetFullPath(file);if(!File.Exists(file))throw new Exception("Solution file not found");
  if(!IsWindowEnabled(main))throw new Exception("Engine busy or modal is open");
  PostMessage(main,0x111,(IntPtr)3,IntPtr.Zero);
  var dialog=WaitDialog(pid);IntPtr edit=IntPtr.Zero,button=IntPtr.Zero;
  for(int i=0;i<600;i++){dialog=Windows(pid).FirstOrDefault(h=>Class(h)=="#32770"&&IsWindowVisible(h));var cs=Children(dialog);edit=cs.FirstOrDefault(h=>Class(h)=="Edit"&&(GetDlgCtrlID(h)==1001||GetDlgCtrlID(h)==1148)&&IsWindowVisible(h));button=cs.FirstOrDefault(h=>Class(h)=="Button"&&GetDlgCtrlID(h)==1&&IsWindowVisible(h)&&IsWindowEnabled(h));if(edit!=IntPtr.Zero&&button!=IntPtr.Zero)break;Thread.Sleep(50);}
  if(edit==IntPtr.Zero||button==IntPtr.Zero)throw new Exception("Unrecognized open dialog");
  if(!IsWindowVisible(main))ShowWindow(dialog,0);
  IntPtr result;if(SendText(edit,12,IntPtr.Zero,file,2,2000,out result)==IntPtr.Zero)throw new Exception("File name update failed");
  PostMessage(button,0xF5,IntPtr.Zero,IntPtr.Zero);
  for(int i=0;i<600;i++){Thread.Sleep(50);if(IsWindowEnabled(main)&&!Windows(pid).Any(h=>Class(h)=="#32770"))return;}
  throw new Exception("Solution load did not complete; inspect original engine");
 }
 // Close visible native dialogs (#32770) owned by the engine. They are application-modal
 // on some builds and block every other command, so automation needs an escape hatch.
 static int DismissDialogs(uint pid){var found=new List<IntPtr>();EnumWindows(delegate(IntPtr h,IntPtr p){uint w;GetWindowThreadProcessId(h,out w);if(w==pid&&IsWindowVisible(h)&&Class(h)=="#32770")found.Add(h);return true;},IntPtr.Zero);foreach(var d in found){PostMessage(d,0x10,IntPtr.Zero,IntPtr.Zero);PostMessage(d,0x111,(IntPtr)2,IntPtr.Zero);foreach(var c in Children(d)){int cid=GetDlgCtrlID(c);if(cid==1||cid==2)PostMessage(c,0xF5,IntPtr.Zero,IntPtr.Zero);}}return found.Count;}
 // Grayed-state check for the Stop item: find the top-level item whose command id is 6
 // (Stop on both 1.6.1 and 3.0.4), then read its state BY POSITION.
 static bool StopGrayed(IntPtr main){var menu=GetMenu(main);int n=GetMenuItemCount(menu);for(int i=0;i<n;i++){if(GetMenuItemID(menu,i)==6)return (GetMenuState(menu,(uint)i,0x400)&3)!=0;}throw new Exception("Stop menu item (command id 6) not found");}
 [STAThread] static int Main(string[] args){try{
  if(args.Length>0&&args[0]=="pick-folder"){using(var picker=new System.Windows.Forms.FolderBrowserDialog()){picker.Description="Choose a HumMod or experiment folder";if(args.Length>1&&Directory.Exists(args[1]))picker.SelectedPath=args[1];Console.WriteLine(picker.ShowDialog()==System.Windows.Forms.DialogResult.OK?picker.SelectedPath:"");}return 0;}
  string root=Path.GetFullPath(Environment.GetEnvironmentVariable("HUMMOD_ENGINE_DIR")??Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"engine"));
  // Only attach to our independent copy, never another HumMod session.
  var matches=Process.GetProcessesByName("HumMod").Where(p=>{try{return string.Equals(p.MainModule.FileName,Path.Combine(root,"HumMod.EXE"),StringComparison.OrdinalIgnoreCase);}catch{return false;}}).ToArray();
  if(args.Length==0) throw new Exception("Command required");
  if(args[0]=="status"){Console.WriteLine(new JavaScriptSerializer().Serialize(new{running=matches.Length==1,pid=matches.Length==1?matches[0].Id:0}));return 0;}
  if(args[0]=="describe"){Console.WriteLine(new JavaScriptSerializer().Serialize(new{engine="HumMod",commands=new[]{"status","start","describe","inspect","audit <jobs.json>","navigate <pageId>","command <menuId>","text <hwnd> <value>","click <hwnd>","show","hide","close","run <goMenuId>","edit <ordinal> <expected> <value>","radio <ordinal> <expected>","action <ordinal> <expected>","check <ordinal> <expected>","slider <ordinal> <pos> <expected>","snapshot <file>","save-state <file>","load-solution <file>","dismiss-modal"},done_when="Stop menu item (command id 6) is grayed; poll run via menu state",notes=new[]{"slider positions may not commit a model value on the 3.0.4 engine; prefer editing model XML parms for initial conditions","dismiss-modal closes native dialogs (e.g. Tech) that block every other command","command ids and control ordinals are per page; enumerate with inspect"}}));return 0;}
  if(args[0]=="start") {if(matches.Length==0) {var p=Process.Start(new ProcessStartInfo(Path.Combine(root,"HumMod.EXE")){WorkingDirectory=root,UseShellExecute=true,WindowStyle=ProcessWindowStyle.Hidden});Console.WriteLine(p.Id);}return 0;}
  if(matches.Length!=1) throw new Exception("Expected one dedicated HumMod process, found "+matches.Length);
  var process=matches[0];var wins=Windows(process.Id);var main=wins.FirstOrDefault(h=>GetMenu(h)!=IntPtr.Zero);
  if(main==IntPtr.Zero)throw new Exception("Engine main window not ready");
  var js=new JavaScriptSerializer(){MaxJsonLength=int.MaxValue};
  if(args[0]=="inspect")Console.WriteLine(js.Serialize(new{pid=process.Id,main=main.ToInt64(),windows=wins.Select(h=>new{window=Info(h),children=Children(h).Select(Info).ToArray()}).ToArray(),menu=Menu(GetMenu(main),"")}));
  else if(args[0]=="audit") {
   var jobs=js.DeserializeObject(File.ReadAllText(args[1])) as object[];var results=new List<object>();
   foreach(Dictionary<string,object> job in jobs){uint id=Convert.ToUInt32(job["id"]);Navigate(main,id);var controls=Children(main);var buttons=controls.Where(c=>Class(c)=="Button").ToArray();results.Add(new{panel=job["panel"],id=id,sliders=controls.Count(c=>Class(c)=="ScrollBar"),edits=controls.Count(c=>Class(c)=="Edit"),radios=buttons.Count(c=>new[]{4,9}.Contains(GetWindowLong(c,-16)&15)),checks=buttons.Count(c=>new[]{2,3,5,6}.Contains(GetWindowLong(c,-16)&15)),actions=buttons.Count(c=>Text(c)=="!")});}
   Console.WriteLine(js.Serialize(results));
  }
  else if(args[0]=="navigate")Navigate(main,uint.Parse(args[1]));
  else if(args[0]=="command") {if(!IsWindowEnabled(main))throw new Exception("Engine has an open modal dialog");uint id=uint.Parse(args[1]);if(!PostMessage(main,0x111,(IntPtr)id,IntPtr.Zero))throw new Exception("Command delivery failed");}
  else if(args[0]=="text") {long target=long.Parse(args[1]);var h=(IntPtr)target;if(!wins.SelectMany(w=>Children(w)).Contains(h))throw new Exception("Control not owned by engine");if(Class(h)!="Edit")throw new Exception("Target is not an edit control");IntPtr res;if(SendText(h,12,IntPtr.Zero,args[2],2,2000,out res)==IntPtr.Zero)throw new Exception("Text update timed out");}
  else if(args[0]=="click") {var h=(IntPtr)long.Parse(args[1]);if(!wins.SelectMany(w=>Children(w)).Contains(h)||Class(h)!="Button")throw new Exception("Invalid button");PostMessage(h,0xF5,IntPtr.Zero,IntPtr.Zero);}
  else if(args[0]=="show")ShowWindow(main,9);
  else if(args[0]=="hide")ShowWindow(main,0);
  else if(args[0]=="close"){PostMessage(main,0x10,IntPtr.Zero,IntPtr.Zero);}
  else if(args[0]=="run") {if(!IsWindowEnabled(main))throw new Exception("A native dialog requires attention");uint id=uint.Parse(args[1]);PostMessage(main,0x111,(IntPtr)id,IntPtr.Zero);Thread.Sleep(150);for(int i=0;i<6000;i++){if(!IsWindowEnabled(main))throw new Exception("A native dialog interrupted simulation");if(StopGrayed(main))return 0;Thread.Sleep(50);}throw new Exception("Simulation is still running; use Stop");}
  else if(args[0]=="edit") {var edits=Children(main).Where(c=>Class(c)=="Edit").OrderBy(GetDlgCtrlID).ToArray();int ordinal=int.Parse(args[1]),expected=int.Parse(args[2]);if(edits.Length!=expected||ordinal<0||ordinal>=edits.Length)throw new Exception("Edit control mapping mismatch");var edit=edits[ordinal];var apply=Children(main).SingleOrDefault(c=>GetDlgCtrlID(c)==GetDlgCtrlID(edit)+1&&Class(c)=="Button"&&Text(c)==">");if(apply==IntPtr.Zero)throw new Exception("Original apply button not found");IntPtr result;if(SendText(edit,12,IntPtr.Zero,args[3],2,2000,out result)==IntPtr.Zero)throw new Exception("Edit timeout");PostMessage(apply,0xF5,IntPtr.Zero,IntPtr.Zero);Thread.Sleep(100);}
  else if(args[0]=="radio"||args[0]=="action"||args[0]=="check") {string kind=args[0];var buttons=Children(main).Where(c=>Class(c)=="Button"&&(kind=="action"?Text(c)=="!":kind=="radio"?new[]{4,9}.Contains(GetWindowLong(c,-16)&15):new[]{2,3,5,6}.Contains(GetWindowLong(c,-16)&15))).OrderBy(GetDlgCtrlID).ToArray();int ordinal=int.Parse(args[1]),expected=int.Parse(args[2]);if(buttons.Length!=expected||ordinal<0||ordinal>=buttons.Length)throw new Exception("Button mapping mismatch");PostMessage(buttons[ordinal],0xF5,IntPtr.Zero,IntPtr.Zero);Thread.Sleep(100);}
  else if(args[0]=="snapshot"){Save(process.Id,main,args[1],4);Console.WriteLine(args[1]);}
  else if(args[0]=="dismiss-modal"){Console.WriteLine(DismissDialogs((uint)process.Id));}
  else if(args[0]=="load-solution"){Load(process.Id,main,args[1]);Console.WriteLine(args[1]);}
  else if(args[0]=="save-state"){Save(process.Id,main,args[1],2);Console.WriteLine(args[1]);}
  else if(args[0]=="slider") {var sliders=Children(main).Where(h=>Class(h)=="ScrollBar").OrderBy(GetDlgCtrlID).ToArray();int ordinal=int.Parse(args[1]),pos=int.Parse(args[2]),expected=int.Parse(args[3]);if(sliders.Length!=expected||ordinal<0||ordinal>=sliders.Length)throw new Exception("Slider mapping mismatch");var slider=sliders[ordinal];int min,max;GetScrollRange(slider,2,out min,out max);if(pos<min||pos>max||pos>65535)throw new Exception("Position outside original slider range");PostMessage(GetParent(slider),0x114,(IntPtr)((pos<<16)|4),slider);Thread.Sleep(100);}
  else throw new Exception("Unknown command");
  return 0;
 }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
}





