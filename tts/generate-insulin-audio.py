"""สร้างไฟล์เสียงบรรยาย (MP3) สำหรับ insulin-teach.html ด้วย AI เสียงไทย

บทพูดอ่านจาก <script id="narration"> ใน insulin-teach.html (แหล่งเดียว แก้บทที่นั่นที่เดียว)
ไฟล์เสียงออกที่ audio/insulin/<id>.mp3 — สร้างใหม่เฉพาะบทที่ข้อความหรือเสียงเปลี่ยน (ดู manifest.json)

ตั้งค่า key ไว้ใน environment หรือไฟล์ tts/.env (ไฟล์นี้ไม่ถูก commit):
  Azure  (ค่าเริ่มต้น):  AZURE_SPEECH_KEY=...  AZURE_SPEECH_REGION=southeastasia
  Google:               GOOGLE_TTS_API_KEY=...

การใช้งาน:
  python tts/generate-insulin-audio.py                 # Azure เสียงเปรมวดี
  python tts/generate-insulin-audio.py --voice th-TH-NiwatNeural
  python tts/generate-insulin-audio.py --provider google --voice th-TH-Neural2-C
  python tts/generate-insulin-audio.py --only s04 d1   # เฉพาะบางบท
  python tts/generate-insulin-audio.py --force         # สร้างใหม่ทั้งหมด
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
from html import escape
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'insulin-teach.html'
OUT = ROOT / 'audio' / 'insulin'
MANIFEST = OUT / 'manifest.json'
DEFAULT_VOICE = {'azure': 'th-TH-PremwadeeNeural', 'google': 'th-TH-Neural2-C'}


def load_env():
    env_file = Path(__file__).resolve().parent / '.env'
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            m = re.match(r'\s*([A-Z_]+)\s*=\s*(.*?)\s*$', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip('"\'')


def load_narration():
    html = PAGE.read_text(encoding='utf-8')
    m = re.search(r'<script type="application/json" id="narration">(.*?)</script>', html, re.S)
    if not m:
        sys.exit('ไม่พบ <script id="narration"> ใน insulin-teach.html')
    return json.loads(m.group(1))


def tts_azure(text, voice, rate):
    key, region = os.environ.get('AZURE_SPEECH_KEY'), os.environ.get('AZURE_SPEECH_REGION', 'southeastasia')
    if not key:
        sys.exit('ยังไม่ได้ตั้ง AZURE_SPEECH_KEY (ใน environment หรือ tts/.env)')
    ssml = (f'<speak version="1.0" xml:lang="th-TH"><voice name="{voice}">'
            f'<prosody rate="{rate:+d}%">{escape(text)}</prosody></voice></speak>')
    r = requests.post(
        f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1',
        headers={'Ocp-Apim-Subscription-Key': key,
                 'Content-Type': 'application/ssml+xml',
                 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
                 'User-Agent': 'tph-insulin-teach'},
        data=ssml.encode('utf-8'), timeout=60)
    r.raise_for_status()
    return r.content


def tts_google(text, voice, rate):
    key = os.environ.get('GOOGLE_TTS_API_KEY')
    if not key:
        sys.exit('ยังไม่ได้ตั้ง GOOGLE_TTS_API_KEY (ใน environment หรือ tts/.env)')
    r = requests.post(
        'https://texttospeech.googleapis.com/v1/text:synthesize',
        headers={'X-Goog-Api-Key': key},
        json={'input': {'text': text},
              'voice': {'languageCode': 'th-TH', 'name': voice},
              'audioConfig': {'audioEncoding': 'MP3', 'speakingRate': 1 + rate / 100}},
        timeout=60)
    r.raise_for_status()
    return base64.b64decode(r.json()['audioContent'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--provider', choices=['azure', 'google'], default='azure')
    ap.add_argument('--voice')
    ap.add_argument('--rate', type=int, default=-5, help='ความเร็ว %% (ลบ = ช้าลง) ค่าเริ่มต้น -5')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--dry-run', action='store_true', help='แสดงรายการและจำนวนตัวอักษร ไม่เรียก API')
    a = ap.parse_args()
    load_env()
    voice = a.voice or DEFAULT_VOICE[a.provider]
    narr = load_narration()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {}

    todo = []
    for cid, text in narr.items():
        if a.only and cid not in a.only:
            continue
        sig = hashlib.sha1(f'{a.provider}|{voice}|{a.rate}|{text}'.encode('utf-8')).hexdigest()
        if not a.force and manifest.get(cid) == sig and (OUT / f'{cid}.mp3').exists():
            continue
        todo.append((cid, text, sig))

    print(f'{a.provider} / {voice} / rate {a.rate:+d}% — ต้องสร้าง {len(todo)} ไฟล์, '
          f'{sum(len(t) for _, t, _ in todo)} ตัวอักษร')
    if a.dry_run:
        for cid, text, _ in todo:
            print(f'  {cid}: {text[:50]}…')
        return
    fn = tts_azure if a.provider == 'azure' else tts_google
    for cid, text, sig in todo:
        (OUT / f'{cid}.mp3').write_bytes(fn(text, voice, a.rate))
        manifest[cid] = sig
        MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding='utf-8')
        print(f'  ✓ {cid}.mp3')
    print('เสร็จแล้ว')


if __name__ == '__main__':
    main()
