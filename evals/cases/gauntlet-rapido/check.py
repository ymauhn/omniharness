"""Part-B assertions for the gauntlet-rapido benchmark (docs/PHASE0_AUDIT.md, section 9 B2).

check_record(obj, expected) -> {"pass": bool, "failures": [str]}
obj is the driver return {confirmados, naoVerificados, refutados, resumo, vistos}, optionally
with agentCount (top level or inside resumo); expected is expected.json.
"""
import sys

LENTES_PADRAO = (
    "o código já trata este caso",
    "o cenário não é alcançável usando o software de verdade",
)


def _near(findings, line, window):
    return [f for f in findings if str(f.get("arquivo", "")).replace("\\", "/").endswith("mod.py")
            and abs(int(f.get("linha", -10 ** 6)) - line) <= window]


def check_record(obj, expected):
    failures = []
    w = expected["janelaDup"]
    conf = obj.get("confirmados", [])
    nao = obj.get("naoVerificados", [])
    ref = obj.get("refutados", [])
    r = obj.get("resumo", {})

    if not any(_near(conf, ln, w) for ln in expected["plantedLines"].values()):
        failures.append("recall: none of %s within +-%d in confirmados" % (expected["plantedLines"], w))
    decoy = _near(conf + nao, expected["decoyLine"], w)
    if decoy:
        failures.append("decoy: %d finding(s) within +-%d of line %d" % (len(decoy), w, expected["decoyLine"]))
    try:
        lhs = r["achadosBrutos"] - r["duplicadosFundidos"] - r["descartadosJanela"]
        rhs = len(conf) + len(ref) + len(nao)
        if lhs != rhs:
            failures.append("identity: brutos-fundidos-janela=%d != conf+ref+nao=%d" % (lhs, rhs))
    except KeyError as e:
        failures.append("identity: resumo lacks %s" % e)
    for f in conf + ref + nao:
        for v in f.get("votos", []):
            if v.get("lente") not in LENTES_PADRAO:
                failures.append("lente: %r on %s:%s" % (v.get("lente"), f.get("arquivo"), f.get("linha")))
    n = obj.get("agentCount", r.get("agentCount"))
    if n is not None and n > expected["agentesMax"]:
        failures.append("agentCount %d > %d" % (n, expected["agentesMax"]))
    if r.get("parouPor") == "teto":
        failures.append("parouPor == teto")
    return {"pass": not failures, "failures": failures}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    exp = {"plantedLines": {"L1": 16, "L2": 29}, "decoyLine": 42, "janelaDup": 4, "agentesMax": 36}

    def fnd(ln, **k):
        return dict({"arquivo": "evals/cases/gauntlet-rapido/buggy/mod.py", "linha": ln,
                     "votos": [{"lente": LENTES_PADRAO[0]}, {"lente": LENTES_PADRAO[1]}]}, **k)

    resumo = {"achadosBrutos": 3, "duplicadosFundidos": 1, "descartadosJanela": 0, "parouPor": "rodadas"}
    good = {"confirmados": [fnd(17)], "refutados": [fnd(5)], "naoVerificados": [], "resumo": resumo, "agentCount": 8}
    assert check_record(good, exp) == {"pass": True, "failures": []}
    bad = {"confirmados": [fnd(40)], "refutados": [fnd(5, votos=[{"lente": "x"}])], "naoVerificados": [fnd(30)],
           "resumo": dict(resumo, parouPor="teto"), "agentCount": 37}
    fails = check_record(bad, exp)["failures"]
    assert [x.split(":")[0].split(" ")[0] for x in fails] == ["recall", "decoy", "identity", "lente", "agentCount", "parouPor"], fails
    print("check.py self-check OK")
