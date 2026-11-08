#!/usr/bin/env python3
"""Turn collected padel.feedback/1 records into a fix list per stroke and version.

Inputs (any mix): exported JSON arrays from the "My feedback > Export JSON" button, single-record JSON files or JSONL,
directories of them (e.g. a `modal volume get padel-feedback items ./feedback_dump` copy), and with --github the
"[feedback]" issues on emre-akarsu/padel (needs the gh CLI).

    python feedback/tools/aggregate.py ./feedback_dump ~/Downloads/padel-feedback-*.json --github --out feedback/out

Writes <out>/fix_list.md (readable), <out>/fix_list.json (for the ideal-stroke fixer) and <out>/shots/<id>.jpg.
Each record's spec_hash is compared with the specs on disk (strikes/specs/*.json, strikes/kick_*/kick.json and any
--specs paths), so the list says whether a report is about the current version of the stroke or an older one.
Pure code, no LLM.
"""
import argparse, base64, collections, glob, hashlib, json, math, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SEV_W = {"minor": 1, "major": 3, "broken": 5}


# ---------- JS-compatible JSON.stringify, so hashes match FB.hash() in the browser ----------
def _num(x):
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if math.isnan(x) or math.isinf(x):
        return "null"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    r = repr(x)
    if "e" not in r:
        return r
    m, e = r.split("e"); e = int(e)
    if -7 < e < 21:  # JS prints these without exponent
        digits = m.replace("-", "").replace(".", ""); neg = m.startswith("-")
        point = (m.lstrip("-").find(".") if "." in m else len(m.lstrip("-"))) + e
        if point <= 0:
            s = "0." + "0" * (-point) + digits
        else:
            s = digits[:point] + ("." + digits[point:] if digits[point:] else "") if point < len(digits) else digits + "0" * (point - len(digits))
        return ("-" if neg else "") + s.rstrip(".")
    return m + "e" + ("+" if e > 0 else "-") + str(abs(e))


def js_stringify(o):
    if o is None:
        return "null"
    if isinstance(o, (bool, int, float)):
        return _num(o)
    if isinstance(o, str):
        return json.dumps(o, ensure_ascii=False)
    if isinstance(o, list):
        return "[" + ",".join(js_stringify(v) for v in o) + "]"
    return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + js_stringify(v) for k, v in o.items()) + "}"


def spec_hash(t):
    return hashlib.sha256(js_stringify(t).encode("utf-8")).hexdigest()[:12]


def current_specs(extra):
    files = glob.glob(os.path.join(ROOT, "strikes", "specs", "*.json")) + glob.glob(os.path.join(ROOT, "strikes", "kick_*", "kick.json")) + list(extra)
    by_hash, latest = {}, {}
    for f in files:
        try:
            d = json.load(open(f, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        techs = (d.get("techniques") or ([d] if "phases" in d else [])) if isinstance(d, dict) else []
        for t in techs:
            h = spec_hash(t); rel = os.path.relpath(f, ROOT)
            by_hash[h] = (rel, t.get("id"))
            if "/specs/" in rel.replace("\\", "/"):
                latest[(d.get("sport"), t.get("id"))] = h
    return by_hash, latest


# ---------- loading ----------
def records_from(obj):
    if isinstance(obj, list):
        for x in obj:
            yield from records_from(x)
    elif isinstance(obj, dict) and obj.get("schema", "").startswith("padel.feedback/"):
        yield obj


def load_paths(paths):
    out = []
    for p in paths:
        files = [p] if os.path.isfile(p) else [f for f in glob.glob(os.path.join(p, "**", "*"), recursive=True) if re.search(r"\.(json|jsonl)$", f)]
        for f in files:
            try:
                txt = open(f, encoding="utf-8").read()
                try:
                    out += list(records_from(json.loads(txt)))
                except ValueError:
                    for line in txt.splitlines():
                        if line.strip():
                            out += list(records_from(json.loads(line)))
            except (OSError, ValueError) as e:
                print(f"skip {f}: {e}", file=sys.stderr)
    return out


def load_github(repo):
    try:
        raw = subprocess.run(["gh", "api", "-X", "GET", "search/issues", "-f", f'q=repo:{repo} "[feedback]" in:title', "-f", "per_page=100", "--paginate",
                              "--jq", ".items[] | {n: .number, body: .body, url: .html_url}"], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"github: {e}", file=sys.stderr); return []
    out = []
    for line in raw.splitlines():
        it = json.loads(line); m = re.search(r"```json\s*(\{.*\})\s*```", it.get("body") or "", re.S)
        if not m:
            continue
        try:
            rec = json.loads(m.group(1))
        except ValueError:
            continue
        rec.setdefault("extra", {})["github_issue"] = it["url"]; out.append(rec)
    return out


# ---------- aggregate ----------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*")
    ap.add_argument("--github", action="store_true", help="also read [feedback] issues via gh")
    ap.add_argument("--repo", default="emre-akarsu/padel")
    ap.add_argument("--specs", nargs="*", default=[], help="extra spec JSON files to recognise versions (e.g. knowledge/ideal_strokes/v1/*.spec.json)")
    ap.add_argument("--out", default=os.path.join(ROOT, "feedback", "out"))
    a = ap.parse_args()

    recs = load_paths(a.inputs) + (load_github(a.repo) if a.github else [])
    seen, items = set(), []
    for r in recs:  # newest copy wins on duplicate ids (device export + sink + issue)
        if r.get("id") in seen:
            continue
        seen.add(r.get("id")); items.append(r)
    by_hash, latest = current_specs(a.specs)
    os.makedirs(os.path.join(a.out, "shots"), exist_ok=True)

    groups = collections.OrderedDict()
    for r in sorted(items, key=lambda r: r.get("created", "")):
        s, m, f, app = r.get("subject", {}), r.get("moment", {}), r.get("feedback", {}), r.get("app", {})
        key = (s.get("sport") or "?", s.get("stroke_id") or "?")
        g = groups.setdefault(key, {"sport": key[0], "stroke_id": key[1], "stroke_name": s.get("stroke_name"), "versions": collections.OrderedDict()})
        h = s.get("spec_hash")
        vkey = f'{app.get("id")} {app.get("version") or ""} #{h or "-"}'
        known = by_hash.get(h)
        v = g["versions"].setdefault(vkey, {"app": app.get("id"), "version": app.get("version"), "spec_hash": h,
                                            "spec_on_disk": f"{known[0]}:{known[1]}" if known else None,
                                            "is_latest_spec": bool(h) and latest.get(key) == h, "items": []})
        shot = (r.get("attachments") or {}).get("screenshot")
        shot_path = None
        if isinstance(shot, str) and shot.startswith("data:image/"):
            shot_path = os.path.join("shots", r["id"] + ".jpg")
            open(os.path.join(a.out, shot_path), "wb").write(base64.b64decode(shot.split(",", 1)[1]))
        ex = r.get("extra") or {}
        v["items"].append({"id": r.get("id"), "created": r.get("created"), "kind": r.get("kind", "general"), "rating": f.get("rating"),
                           "error": (ex.get("error") or {}).get("msg"), "session": ex.get("session_line"), "severity": f.get("severity", "major"), "tags": f.get("tags", []), "text": f.get("text", ""),
                           "t_s": m.get("t_s"), "frame": m.get("frame"), "stage": m.get("stage"), "stage_label": m.get("stage_label"), "cue": m.get("cue"),
                           "panel": (r.get("extra") or {}).get("panel"), "hand": s.get("hand"), "url": r.get("url"), "issue": (r.get("extra") or {}).get("github_issue"),
                           "screenshot": shot_path, "client": (r.get("client") or {}).get("anon")})

    fix = []
    for g in groups.values():
        all_it = [i for v in g["versions"].values() for i in v["items"]]
        tags = collections.Counter(t for i in all_it for t in i["tags"])
        stages = collections.Counter(i["stage_label"] or i["stage"] or "?" for i in all_it)
        score = sum(SEV_W.get(i["severity"], 3) for i in all_it)
        cur = sum(SEV_W.get(i["severity"], 3) for v in g["versions"].values() if v["is_latest_spec"] or v["spec_on_disk"] for i in v["items"])
        kinds = collections.Counter(i["kind"] for i in all_it)
        ratings = collections.Counter(i["rating"] for i in all_it if i["rating"])
        fix.append({**{k: g[k] for k in ("sport", "stroke_id", "stroke_name")}, "reports": len(all_it), "kinds": dict(kinds), "ratings": dict(ratings), "score": score, "score_on_current_specs": cur,
                    "reporters": len({i["client"] for i in all_it}), "top_tags": tags.most_common(6), "stages": stages.most_common(6),
                    "versions": list(g["versions"].values())})
    fix.sort(key=lambda x: (-x["score_on_current_specs"], -x["score"]))
    # app errors across all records: the reported error plus the recent-error log each record carries
    errs = collections.OrderedDict()
    for r in items:
        ex = r.get("extra") or {}
        for e in ([ex["error"]] if ex.get("error") else []) + (ex.get("recent_errors") or []):
            k = re.sub(r"\d+", "#", e.get("msg", ""))[:160]
            d = errs.setdefault(k, {"msg": e.get("msg"), "kind": e.get("kind"), "src": e.get("src"), "line": e.get("line"), "records": set(), "reported": 0, "apps": set(), "first": r.get("created"), "last": r.get("created")})
            d["records"].add(r.get("id")); d["apps"].add(f'{(r.get("app") or {}).get("id")} {(r.get("app") or {}).get("version") or ""}'.strip()); d["last"] = max(d["last"] or "", r.get("created") or "")
            if ex.get("error") is e:
                d["reported"] += 1
    err_list = sorted(({**d, "records": len(d["records"]), "apps": sorted(d["apps"])} for d in errs.values()), key=lambda d: (-d["reported"], -d["records"]))
    json.dump({"schema": "padel.fixlist/1", "records": len(items), "kinds": dict(collections.Counter(r.get("kind", "general") for r in items)), "errors": err_list, "strokes": fix}, open(os.path.join(a.out, "fix_list.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    L = [f"# Feedback fix list\n\n{len(items)} reports on {len(fix)} strokes. Score = minor 1, major 3, broken 5. "
         "\"current\" means the reported spec hash still matches a spec on disk, so the fault is probably still there. "
         "Kinds: " + ", ".join(f"{k} {n}" for k, n in collections.Counter(r.get("kind", "general") for r in items).items()) + "\n"]
    if err_list:
        L.append("\n## App errors\n\n| Error | Kind | Where | Reported by user | In records | Apps | Last seen |\n|---|---|---|---|---|---|---|\n")
        for d in err_list[:40]:
            L.append(f"| {str(d['msg']).replace('|', '/')[:140]} | {d['kind']} | {d['src'] or ''}{':' + str(d['line']) if d['line'] else ''} | {d['reported']} | {d['records']} | {', '.join(d['apps'])} | {(d['last'] or '')[:16]} |\n")
    for x in fix:
        L.append(f"\n## {x['sport']} · {x['stroke_name'] or x['stroke_id']} (`{x['stroke_id']}`)\n\n{x['reports']} reports from {x['reporters']} devices · score {x['score']} "
                 f"({x['score_on_current_specs']} on current specs){' · drill/session 👍 ' + str(x['ratings'].get('up', 0)) + ' 👎 ' + str(x['ratings'].get('down', 0)) if x['ratings'] else ''} · tags: {', '.join(f'{t} {n}' for t, n in x['top_tags']) or '-'} · stages: {', '.join(f'{t} {n}' for t, n in x['stages'])}\n")
        for v in x["versions"]:
            state = "latest spec" if v["is_latest_spec"] else ("on disk: " + v["spec_on_disk"]) if v["spec_on_disk"] else "older or unknown spec"
            L.append(f"\n**{v['app']} {v['version'] or ''}** · spec `#{v['spec_hash'] or '-'}` · {state}\n")
            for i in sorted(v["items"], key=lambda i: (i["t_s"] if i["t_s"] is not None else 1e9)):
                where = " · ".join(str(p) for p in [i["stage_label"] or i["stage"], f"t={i['t_s']} s" if i["t_s"] is not None else None,
                                                     f"frame {i['frame']}" if i["frame"] is not None else None, i["panel"]] if p)
                links = " ".join(p for p in [f"[frame]({i['screenshot']})" if i["screenshot"] else "", f"[open]({i['url']})" if i["url"] else "",
                                             f"[issue]({i['issue']})" if i["issue"] else ""] if p)
                kind = "" if i["kind"] == "general" else f"{i['kind']}{' ' + ('👍' if i['rating'] == 'up' else '👎') if i['rating'] else ''}: "
                if i["error"]:
                    kind += f"`{i['error'][:120]}` "
                L.append(f"- [{i['severity']}] {kind}{where} · {', '.join(i['tags']) or '-'}: {i['text'] or '(no text)'} {links}".rstrip() + "\n")
    open(os.path.join(a.out, "fix_list.md"), "w", encoding="utf-8").write("".join(L))
    print(f"{len(items)} records -> {len(fix)} strokes -> {os.path.join(a.out, 'fix_list.md')}")


if __name__ == "__main__":
    main()
