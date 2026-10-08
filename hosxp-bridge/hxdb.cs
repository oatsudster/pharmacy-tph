// ตัวต่อ MySQL ขนาดเล็กสำหรับ HOSxP Bridge — อ่านอย่างเดียว (SELECT) ไม่ต้องใช้ dll/exe เพิ่ม
// PowerShell คอมไพล์ไฟล์นี้เองตอนเปิด bridge (Add-Type) เครื่อง รพ. ที่บล็อก exe ที่ไม่ได้ลงลายเซ็นจึงยังใช้ได้
// รองรับ MySQL 8 (caching_sha2_password ผ่าน TLS และ mysql_native_password) คืนผลเป็นข้อความทุกคอลัมน์
// C# 5 (คอมไพเลอร์ของ .NET Framework ที่ PowerShell 5.1 ใช้) — ห้ามใช้ $"..", out var, =>
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Text;

public class HxDb : IDisposable {
  string host, user, password, database; int port;
  TcpClient tcp; Stream s; byte seq;
  public string LastError = "";

  public HxDb(string host, int port, string user, string password, string database) {
    this.host = host; this.port = port; this.user = user; this.password = password; this.database = database;
  }

  public bool Connected { get { return s != null; } }

  public void Dispose() { Close(); }
  public void Close() {
    try { if (s != null) s.Dispose(); } catch {}
    try { if (tcp != null) tcp.Close(); } catch {}
    s = null; tcp = null;
  }

  // ── packets ──
  byte[] ReadPacket() {
    byte[] h = ReadN(4);
    int len = h[0] | (h[1] << 8) | (h[2] << 16);
    seq = (byte)(h[3] + 1);
    byte[] p = ReadN(len);
    if (len == 0xFFFFFF) {   // ผลแถวเดียวใหญ่เกิน 16MB ไม่มีในงานนี้ แต่รวมให้ถูกต้อง
      byte[] rest = ReadPacket(); byte[] all = new byte[p.Length + rest.Length];
      Buffer.BlockCopy(p, 0, all, 0, p.Length); Buffer.BlockCopy(rest, 0, all, p.Length, rest.Length); return all;
    }
    return p;
  }
  byte[] ReadN(int n) {
    byte[] b = new byte[n]; int o = 0;
    while (o < n) { int r = s.Read(b, o, n - o); if (r <= 0) throw new IOException("MySQL ปิดการเชื่อมต่อ"); o += r; }
    return b;
  }
  void WritePacket(byte[] p) {
    byte[] h = new byte[4] { (byte)p.Length, (byte)(p.Length >> 8), (byte)(p.Length >> 16), seq };
    seq++;
    s.Write(h, 0, 4); s.Write(p, 0, p.Length); s.Flush();
  }
  static void CheckErr(byte[] p) {
    if (p.Length > 0 && p[0] == 0xFF) {
      int code = p[1] | (p[2] << 8);
      int off = (p.Length > 3 && p[3] == (byte)'#') ? 9 : 3;
      throw new Exception("MySQL " + code + ": " + Encoding.UTF8.GetString(p, off, p.Length - off));
    }
  }

  // ── connect + auth ──
  const uint CAP_LONG_PASSWORD = 1, CAP_LONG_FLAG = 4, CAP_CONNECT_WITH_DB = 8, CAP_PROTOCOL_41 = 0x200,
    CAP_SSL = 0x800, CAP_TRANSACTIONS = 0x2000, CAP_SECURE_CONNECTION = 0x8000, CAP_PLUGIN_AUTH = 0x80000;
  const byte UTF8MB4 = 45;   // utf8mb4_general_ci — server แปลงคอลัมน์ tis620 เป็น UTF-8 ให้

  public void Connect(int timeoutMs) {
    Close();
    tcp = new TcpClient();
    IAsyncResult ar = tcp.BeginConnect(host, port, null, null);
    if (!ar.AsyncWaitHandle.WaitOne(timeoutMs)) { tcp.Close(); tcp = null; throw new TimeoutException("ต่อ " + host + ":" + port + " ไม่ได้ (หมดเวลา)"); }
    tcp.EndConnect(ar);
    tcp.ReceiveTimeout = 20000; tcp.SendTimeout = 20000;
    s = tcp.GetStream();
    seq = 0;
    byte[] hs = ReadPacket();
    CheckErr(hs);
    int i = 1;
    while (hs[i] != 0) i++;   // server version
    i += 1 + 4;               // NUL + connection id
    byte[] nonce = new byte[20];
    Buffer.BlockCopy(hs, i, nonce, 0, 8); i += 8 + 1;
    uint caps = (uint)(hs[i] | (hs[i + 1] << 8)); i += 2;
    i += 1 + 2;               // charset + status
    caps |= (uint)((hs[i] | (hs[i + 1] << 8)) << 16); i += 2;
    int authLen = hs[i]; i += 1 + 10;
    int part2 = Math.Max(13, authLen - 8);
    Buffer.BlockCopy(hs, i, nonce, 8, 12); i += part2;
    string plugin = "mysql_native_password";
    if (i < hs.Length) { int e = Array.IndexOf(hs, (byte)0, i); if (e < 0) e = hs.Length; plugin = Encoding.ASCII.GetString(hs, i, e - i); }

    uint my = CAP_LONG_PASSWORD | CAP_LONG_FLAG | CAP_PROTOCOL_41 | CAP_TRANSACTIONS | CAP_SECURE_CONNECTION | CAP_PLUGIN_AUTH;
    if (!string.IsNullOrEmpty(database)) my |= CAP_CONNECT_WITH_DB;
    bool tls = (caps & CAP_SSL) != 0;
    if (tls) {
      my |= CAP_SSL;
      WritePacket(Head(my));
      // ใบรับรองของ MySQL ใน รพ. เป็นแบบ self-signed — ใช้ TLS เพื่อเข้ารหัสรหัสผ่าน/ข้อมูลใน LAN ไม่ได้ใช้ยืนยันตัวตน server
      SslStream ssl = new SslStream(s, false, delegate { return true; });
      ssl.AuthenticateAsClient(host, null, SslProtocols.Tls12, false);
      s = ssl;
    }
    MemoryStream m = new MemoryStream();
    W(m, Head(my));
    W(m, Encoding.UTF8.GetBytes(user)); m.WriteByte(0);
    byte[] scr = Scramble(plugin, nonce);
    m.WriteByte((byte)scr.Length); W(m, scr);
    if (!string.IsNullOrEmpty(database)) { W(m, Encoding.UTF8.GetBytes(database)); m.WriteByte(0); }
    W(m, Encoding.ASCII.GetBytes(plugin)); m.WriteByte(0);
    WritePacket(m.ToArray());

    while (true) {
      byte[] r = ReadPacket();
      CheckErr(r);
      if (r[0] == 0x00) {   // OK
        // server ของ รพ. ไม่ใช้ charset ที่ขอตอน handshake (ส่งภาษาไทยมาเป็น tis620) ต้องสั่ง SET NAMES อีกที
        RunRaw("SET NAMES utf8mb4");
        return;
      }
      if (r[0] == 0xFE) {         // auth switch
        int e = Array.IndexOf(r, (byte)0, 1);
        plugin = Encoding.ASCII.GetString(r, 1, e - 1);
        byte[] n2 = new byte[20]; Buffer.BlockCopy(r, e + 1, n2, 0, Math.Min(20, r.Length - e - 1)); nonce = n2;
        WritePacket(Scramble(plugin, nonce));
        continue;
      }
      if (r[0] == 0x01 && r.Length >= 2) {
        if (r[1] == 0x03) continue;   // fast auth สำเร็จ — ตามด้วย OK
        if (r[1] == 0x04) {           // full auth: ส่งรหัสผ่านตรงๆ ได้เพราะอยู่ใน TLS แล้ว
          if (!tls) throw new Exception("server ต้องการ TLS เพื่อยืนยันรหัสผ่าน แต่ไม่รองรับ TLS");
          byte[] pw = Encoding.UTF8.GetBytes(password); byte[] z = new byte[pw.Length + 1];
          Buffer.BlockCopy(pw, 0, z, 0, pw.Length); WritePacket(z);
          continue;
        }
      }
      throw new Exception("ยืนยันตัวตน MySQL ไม่สำเร็จ (ตอบกลับ 0x" + r[0].ToString("X2") + ")");
    }
  }

  static byte[] Head(uint caps) {
    byte[] b = new byte[32];
    b[0] = (byte)caps; b[1] = (byte)(caps >> 8); b[2] = (byte)(caps >> 16); b[3] = (byte)(caps >> 24);
    b[4] = 0; b[5] = 0; b[6] = 0; b[7] = 1;   // max packet 16MB
    b[8] = UTF8MB4;
    return b;
  }
  static void W(MemoryStream m, byte[] b) { m.Write(b, 0, b.Length); }

  byte[] Scramble(string plugin, byte[] nonce) {
    if (string.IsNullOrEmpty(password)) return new byte[0];
    byte[] pw = Encoding.UTF8.GetBytes(password);
    if (plugin == "caching_sha2_password") {
      using (SHA256 h = SHA256.Create()) {
        byte[] p1 = h.ComputeHash(pw), p2 = h.ComputeHash(p1);
        byte[] cat = new byte[p2.Length + nonce.Length];
        Buffer.BlockCopy(p2, 0, cat, 0, p2.Length); Buffer.BlockCopy(nonce, 0, cat, p2.Length, nonce.Length);
        byte[] p3 = h.ComputeHash(cat);
        for (int k = 0; k < p1.Length; k++) p1[k] ^= p3[k];
        return p1;
      }
    }
    using (SHA1 h = SHA1.Create()) {   // mysql_native_password
      byte[] p1 = h.ComputeHash(pw), p2 = h.ComputeHash(p1);
      byte[] cat = new byte[nonce.Length + p2.Length];
      Buffer.BlockCopy(nonce, 0, cat, 0, nonce.Length); Buffer.BlockCopy(p2, 0, cat, nonce.Length, p2.Length);
      byte[] p3 = h.ComputeHash(cat);
      for (int k = 0; k < p1.Length; k++) p1[k] ^= p3[k];
      return p1;
    }
  }

  // ── query ──
  static long LenInt(byte[] p, ref int i) {
    byte b = p[i++];
    if (b < 0xFB) return b;
    if (b == 0xFB) return -1;   // NULL
    if (b == 0xFC) { long v = p[i] | (p[i + 1] << 8); i += 2; return v; }
    if (b == 0xFD) { long v = p[i] | (p[i + 1] << 8) | (p[i + 2] << 16); i += 3; return v; }
    long r = BitConverter.ToInt64(p, i); i += 8; return r;
  }
  static string LenStr(byte[] p, ref int i) {
    long n = LenInt(p, ref i);
    if (n < 0) return null;
    string v = Encoding.UTF8.GetString(p, i, (int)n); i += (int)n; return v;
  }
  static bool IsEof(byte[] p) { return p.Length < 9 && p.Length > 0 && p[0] == 0xFE; }

  // ส่งคำสั่ง SQL หนึ่งคำสั่ง คืนแถวเป็น ชื่อคอลัมน์ → ข้อความ (NULL = null) — ต่อใหม่เองครั้งหนึ่งถ้าการเชื่อมต่อเดิมหลุด
  public List<Dictionary<string, string>> Query(string sql) {
    for (int attempt = 0; ; attempt++) {
      try {
        if (s == null) Connect(4000);
        return QueryOnce(sql);
      } catch (Exception e) {
        LastError = e.Message;
        bool sqlErr = e.Message.StartsWith("MySQL ") && s != null;
        if (!sqlErr) Close();
        if (sqlErr || attempt >= 1) throw;
      }
    }
  }

  List<Dictionary<string, string>> QueryOnce(string sql) {
    if (!sql.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase) &&
        !sql.TrimStart().StartsWith("WITH", StringComparison.OrdinalIgnoreCase))
      throw new Exception("อนุญาตเฉพาะคำสั่ง SELECT");
    return RunRaw(sql);
  }

  List<Dictionary<string, string>> RunRaw(string sql) {
    seq = 0;
    byte[] q = Encoding.UTF8.GetBytes(sql); byte[] p = new byte[q.Length + 1];
    p[0] = 0x03; Buffer.BlockCopy(q, 0, p, 1, q.Length);
    WritePacket(p);
    byte[] first = ReadPacket();
    CheckErr(first);
    List<Dictionary<string, string>> rows = new List<Dictionary<string, string>>();
    if (first[0] == 0x00) return rows;
    int i = 0; int ncol = (int)LenInt(first, ref i);
    string[] names = new string[ncol];
    for (int c = 0; c < ncol; c++) {
      byte[] cd = ReadPacket(); int j = 0;
      for (int k = 0; k < 4; k++) LenStr(cd, ref j);   // catalog, schema, table, org_table
      names[c] = LenStr(cd, ref j);
    }
    byte[] eof = ReadPacket(); CheckErr(eof);
    while (true) {
      byte[] r = ReadPacket();
      CheckErr(r);
      if (IsEof(r)) break;
      Dictionary<string, string> row = new Dictionary<string, string>();
      int j = 0;
      for (int c = 0; c < ncol; c++) row[names[c]] = LenStr(r, ref j);
      rows.Add(row);
    }
    return rows;
  }

  // ค่าที่จะใส่ใน SQL: รับเฉพาะตัวเลข/วันที่ ตามรูปแบบที่กำหนด ไม่ต่อข้อความจากภายนอกเข้า SQL ตรงๆ
  public static string Digits(string v) {
    if (v == null) return null;
    v = v.Trim();
    foreach (char ch in v) if (ch < '0' || ch > '9') return null;
    return v.Length > 0 && v.Length <= 15 ? v : null;
  }

  // แถว → JSON (PowerShell 5.1 ConvertTo-Json ช้าและจัดรูปแบบพจนานุกรมแปลก จึงทำเอง)
  public static string Json(object o) {
    StringBuilder sb = new StringBuilder(); J(sb, o); return sb.ToString();
  }
  static void J(StringBuilder sb, object o) {
    if (o == null) { sb.Append("null"); return; }
    // ค่าจาก PowerShell มักห่อเป็น PSObject — แกะเอาตัวจริงข้างใน
    if (o.GetType().FullName == "System.Management.Automation.PSObject") { J(sb, o.GetType().GetProperty("BaseObject").GetValue(o, null)); return; }
    if (o is string) { Str(sb, (string)o); return; }
    if (o is bool) { sb.Append((bool)o ? "true" : "false"); return; }
    if (o is int || o is long || o is double) { sb.Append(Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture)); return; }
    System.Collections.IDictionary d = o as System.Collections.IDictionary;
    if (d != null) {
      sb.Append('{'); bool f = true;
      foreach (System.Collections.DictionaryEntry e in d) { if (!f) sb.Append(','); f = false; Str(sb, e.Key.ToString()); sb.Append(':'); J(sb, e.Value); }
      sb.Append('}'); return;
    }
    System.Collections.IEnumerable a = o as System.Collections.IEnumerable;
    if (a != null) {
      sb.Append('['); bool f = true;
      foreach (object x in a) { if (!f) sb.Append(','); f = false; J(sb, x); }
      sb.Append(']'); return;
    }
    Str(sb, o.ToString());
  }
  static void Str(StringBuilder sb, string v) {
    sb.Append('"');
    foreach (char c in v) {
      if (c == '"') sb.Append("\\\""); else if (c == '\\') sb.Append("\\\\");
      else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
      else sb.Append(c);
    }
    sb.Append('"');
  }
}
