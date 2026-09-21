"""One real Jev request, using the userscript's actual request builder. Never prints a key."""
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
samples = [
    {"type": "comment", "text": "谢谢分享，这个教程很有帮助。"},
    {"type": "comment", "text": "这也能吹？你们是不是没玩过游戏啊🤣", "parent": "一个人做到这个程度已经不错了"},
    {"type": "danmaku", "text": "就这？建议早点进厂"},
    {"type": "comment", "text": "第3分钟的数据可能有误，原论文里写的是15%，建议核对一下。"},
]
builder = "const c=require('./rage-bait-hider.user.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(c.buildRequest('第一次做独立游戏，分享半年的开发经历',JSON.parse(s)))));"
body = subprocess.run(["node", "-e", builder], input=json.dumps(samples), capture_output=True, text=True, cwd=root, check=True).stdout.encode()
key = (root / "jevapi.txt").read_text(encoding="utf-8-sig").strip()
request = urllib.request.Request(
    "https://api.typesafe.ai/v1/systemone", data=body,
    headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=35) as response:
        result = json.load(response)
except urllib.error.HTTPError as error:
    print(f"Jev HTTP {error.code}; response body omitted to protect credentials.")
    sys.exit(1)
except (urllib.error.URLError, TimeoutError):
    print("Network request failed or timed out; no credentials logged.")
    sys.exit(2)
for i in range(len(samples)):
    answer = result.get("answers", {}).get(f"item_{i}", {})
    score = answer.get("noul")
    if answer.get("type") != "noul" or isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 1:
        print(f"Invalid answer for item_{i}")
        sys.exit(1)
    print(f"item_{i}: probability={score:.3f}, hidden_at_0.3={score >= 0.3}")
print("Response schema verified. These four examples are not an accuracy benchmark.")
print("Usage:", json.dumps(result.get("usage", {})))
