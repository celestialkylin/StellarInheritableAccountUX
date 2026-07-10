import { useEffect, useRef, useState } from "react";
import {
  buildMethodArgs,
  coerceMethodArgs,
  getMethodArgFields,
  isLikelyReadOnlyMethod,
  listPublicMethods,
  loadContractSpec,
} from "../services/stellar/contractSpec.js";
import {
  buildInvokeXdr,
  invokeAsContractAccount,
} from "../services/stellar/contractInvoke.js";
import { getContext } from "../services/stellar/context.js";
import {
  buildTemplatePayload,
  isTauriRuntime,
  loadTemplateDialog,
  resolveTemplatesRoot,
  saveTemplateDialog,
} from "../services/invokeTemplates.js";
import { copyTextToClipboard } from "../services/stellar/signingWorkbench.js";

const DEFAULT_TIMEOUT_SECONDS = 300;

/** Floor Date to local minute; return value for datetime-local input. */
function toDatetimeLocalValue(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function floorNowToMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  return d;
}

function defaultTimeboundRange() {
  const start = floorNowToMinute();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    start: toDatetimeLocalValue(start),
    end: toDatetimeLocalValue(end),
  };
}

function datetimeLocalToUnix(value) {
  if (!value) throw new Error("Datetime is required");
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error(`Invalid datetime: ${value}`);
  return Math.floor(ms / 1000);
}

export default function ContractMethodForm({ publicKey }) {
  const [contractId, setContractId] = useState("");
  const [spec, setSpec] = useState(null);
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState("");
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [jsonArgs, setJsonArgs] = useState("{}");
  const [useJson, setUseJson] = useState(false);
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const pendingTemplateRef = useRef(null);

  const [validityMode, setValidityMode] = useState("timeout"); // timeout | timebound
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(DEFAULT_TIMEOUT_SECONDS));
  const [tbStart, setTbStart] = useState(() => defaultTimeboundRange().start);
  const [tbEnd, setTbEnd] = useState(() => defaultTimeboundRange().end);

  const tauriAvailable = isTauriRuntime();

  function applyLoadedTemplate(template, activeSpec) {
    const argFields = getMethodArgFields(activeSpec, template.method);
    setFields(argFields);
    setUseJson(template.useJson);
    if (template.useJson) {
      setJsonArgs(template.jsonArgs);
      setValues({});
    } else {
      setValues({ ...template.values });
      setJsonArgs("{}");
    }
  }

  async function loadSpecForContract(id) {
    const trimmed = id.trim();
    if (!trimmed.startsWith("C")) {
      throw new Error("Contract ID must start with C");
    }
    const loaded = await loadContractSpec(trimmed);
    const names = listPublicMethods(loaded);
    setSpec(loaded);
    setMethods(names);
    return { spec: loaded, methods: names };
  }

  async function loadSpec() {
    pendingTemplateRef.current = null;
    setLoadingSpec(true);
    setSubmitting(false);
    setError("");
    setResult("");
    try {
      const { methods: names } = await loadSpecForContract(contractId);
      setMethod(names[0] || "");
      setUseJson(false);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoadingSpec(false);
    }
  }

  useEffect(() => {
    if (!spec || !method) {
      setFields([]);
      return;
    }
    try {
      const argFields = getMethodArgFields(spec, method);
      setFields(argFields);

      const pending = pendingTemplateRef.current;
      const matchesPending =
        pending &&
        pending.method === method &&
        pending.contractId === contractId.trim();

      if (matchesPending) {
        setUseJson(pending.useJson);
        if (pending.useJson) {
          setJsonArgs(pending.jsonArgs);
          setValues({});
        } else {
          setValues({ ...pending.values });
          setJsonArgs("{}");
        }
      } else if (!pending) {
        setValues({});
        setJsonArgs("{}");
        setUseJson(argFields.length === 0);
      }
    } catch (e) {
      setFields([]);
      setUseJson(true);
      setError(e.message || String(e));
    }
  }, [spec, method, contractId]);

  function resolveValidityOptions() {
    if (validityMode === "timeout") {
      const n = Number(timeoutSeconds);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new Error("Timeout must be a positive integer (seconds)");
      }
      return { timeoutInSeconds: n, timebounds: undefined };
    }
    const minTime = datetimeLocalToUnix(tbStart);
    const maxTime = datetimeLocalToUnix(tbEnd);
    if (maxTime <= minTime) {
      throw new Error("Timebound end must be after start");
    }
    if (maxTime <= Math.floor(Date.now() / 1000)) {
      throw new Error("Timebound end must be in the future");
    }
    return { timeoutInSeconds: undefined, timebounds: { minTime, maxTime } };
  }

  function buildArgsObject() {
    if (useJson) {
      return JSON.parse(jsonArgs);
    }
    return coerceMethodArgs(fields, values);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!spec || !method) return;
    setSubmitting(true);
    setError("");
    setResult("");
    try {
      const validity = resolveValidityOptions();
      const argsObject = buildArgsObject();
      const scVals = buildMethodArgs(spec, method, argsObject);
      const outcome = await invokeAsContractAccount({
        targetContractId: contractId.trim(),
        method,
        args: scVals,
        signerPublicKey: publicKey,
        feePayerPublicKey: publicKey,
        spec,
        ...validity,
      });
      if (outcome.mode === "simulate") {
        setResult(`Simulated result:\n${JSON.stringify(outcome.result, null, 2)}`);
      } else {
        setResult(`Success: ${outcome.hash || JSON.stringify(outcome)}`);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyXdr() {
    if (!spec || !method) return;
    setSubmitting(true);
    setError("");
    setResult("");
    try {
      const validity = resolveValidityOptions();
      const argsObject = buildArgsObject();
      const scVals = buildMethodArgs(spec, method, argsObject);
      const { xdr } = await buildInvokeXdr({
        targetContractId: contractId.trim(),
        method,
        args: scVals,
        publicKey,
        ...validity,
      });
      await copyTextToClipboard(xdr);
      setResult(
        "Raw XDR copied (not simulated). You can paste it into Signing for further processing.",
      );
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveTemplate() {
    if (!spec || !method) {
      setError("Load contract spec before saving a template");
      return;
    }
    setTemplateBusy(true);
    setError("");
    try {
      const { config } = getContext();
      const root = await resolveTemplatesRoot(config);
      const payload = buildTemplatePayload({
        contractId: contractId.trim(),
        method,
        useJson,
        values,
        jsonArgs,
      });
      const saved = await saveTemplateDialog({
        root,
        contractId: contractId.trim(),
        method,
        payload,
      });
      if (saved) {
        const dirHint = saved.contractDir ? ` → ${saved.contractDir}/${method}/` : "";
        setResult(`Saved template: ${saved.name}${dirHint}`);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function handleLoadTemplate() {
    setTemplateBusy(true);
    setError("");
    setResult("");
    try {
      const { config } = getContext();
      const root = await resolveTemplatesRoot(config);
      const loaded = await loadTemplateDialog({
        root,
        contractId: contractId.trim(),
        method: method || "template",
      });
      if (!loaded) return;

      const { template, name } = loaded;
      const needsSpec =
        !spec ||
        contractId.trim() !== template.contractId ||
        !methods.includes(template.method);

      const unchanged =
        !needsSpec &&
        contractId.trim() === template.contractId &&
        method === template.method;

      pendingTemplateRef.current = template;
      setContractId(template.contractId);

      let activeSpec = spec;
      if (needsSpec) {
        setLoadingSpec(true);
        try {
          const loadedSpec = await loadSpecForContract(template.contractId);
          if (!loadedSpec.methods.includes(template.method)) {
            throw new Error(`Method "${template.method}" not found in contract spec`);
          }
          activeSpec = loadedSpec.spec;
        } finally {
          setLoadingSpec(false);
        }
      }

      setMethod(template.method);

      if (unchanged) {
        applyLoadedTemplate(template, activeSpec);
      }

      setError("");
      const dirHint = loaded.contractDir ? ` (dir: ${loaded.contractDir})` : "";
      setResult(`Loaded template: ${name}${dirHint}`);
    } catch (e) {
      pendingTemplateRef.current = null;
      setError(e.message || String(e));
    } finally {
      setTemplateBusy(false);
    }
  }

  function selectValidityMode(mode) {
    setValidityMode(mode);
    if (mode === "timebound") {
      const range = defaultTimeboundRange();
      setTbStart(range.start);
      setTbEnd(range.end);
    }
  }

  const loadSpecDisabled = loadingSpec || submitting || templateBusy;
  const invokeDisabled = loadingSpec || submitting || templateBusy;
  const templateDisabled = loadingSpec || submitting || templateBusy || !tauriAvailable;
  const loadSpecLabel = loadingSpec ? "Loading…" : "Load Spec";
  const readOnlyMethod = spec && method && isLikelyReadOnlyMethod(spec, method);
  const invokeLabel = submitting
    ? (readOnlyMethod ? "Simulating…" : "Submitting…")
    : (readOnlyMethod ? "Simulate" : "Invoke as Contract Account");

  const tbMinUnix = (() => {
    try {
      return datetimeLocalToUnix(tbStart);
    } catch {
      return null;
    }
  })();
  const tbMaxUnix = (() => {
    try {
      return datetimeLocalToUnix(tbEnd);
    } catch {
      return null;
    }
  })();

  return (
    <div className="card">
      <h3>Contract Method Invoke</h3>
      <label>Target Contract ID</label>
      <div className="row-actions">
        <input
          value={contractId}
          onChange={(e) => {
            pendingTemplateRef.current = null;
            setContractId(e.target.value);
          }}
          placeholder="C…"
          style={{ flex: 1 }}
        />
        <button type="button" onClick={loadSpec} disabled={loadSpecDisabled}>
          {loadSpecLabel}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleLoadTemplate}
          disabled={templateDisabled}
          title={tauriAvailable ? "Load a parameter template" : "Requires Tauri desktop app"}
        >
          {templateBusy ? "Loading…" : "Load Template"}
        </button>
      </div>
      {!tauriAvailable && (
        <p className="meta">Template save/load is available in the Tauri desktop app only.</p>
      )}

      {methods.length > 0 && (
        <>
          <label>Method</label>
          <select
            value={method}
            onChange={(e) => {
              pendingTemplateRef.current = null;
              setMethod(e.target.value);
            }}
          >
            {methods.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <div className="toggle-row">
            <div className="toggle-label">
              <span className="toggle-title">JSON argument mode</span>
              <span className="toggle-desc">Enable to enter arguments as JSON (for complex types)</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={useJson}
                onChange={(e) => setUseJson(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>

          {useJson ? (
            <>
              <label>Arguments (JSON object)</label>
              <textarea rows={5} value={jsonArgs} onChange={(e) => setJsonArgs(e.target.value)} />
            </>
          ) : fields.length > 0 ? (
            <div className="arg-fields">
              <p className="meta section-label">Method parameters</p>
              {fields.map((f) => (
                <div key={f.name} className="arg-field">
                  <label>
                    {f.name}{f.required ? " *" : ""}
                    <span className="type-hint">{f.typeHint}</span>
                  </label>
                  {f.enum ? (
                    <select
                      value={values[f.name] || ""}
                      onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                    >
                      <option value="">—</option>
                      {f.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : f.type === "boolean" || f.typeHint === "bool" ? (
                    <select
                      value={values[f.name] || ""}
                      onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                    >
                      <option value="">—</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : f.type === "array" || String(f.typeHint).startsWith("array") ? (
                    <textarea
                      rows={2}
                      placeholder='JSON array, e.g. ["G...", "100"]'
                      value={values[f.name] || ""}
                      onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                    />
                  ) : (
                    <input
                      value={values[f.name] || ""}
                      onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                      placeholder={
                        f.typeHint === "Address"
                          ? "G… or C…"
                          : (() => {
                              const m = /^bytesN\((\d+)\)$/.exec(f.typeHint || "");
                              if (m) return `${Number(m[1]) * 2}-char hex`;
                              if (f.typeHint === "bytes") return "hex or base64:…";
                              return "";
                            })()
                      }
                    />
                  )}
                  {f.description && <span className="meta">{f.description}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="meta">This method has no parameters.</p>
          )}

          <div className="validity-block">
            <p className="meta section-label">Transaction validity</p>
            <div className="radio-row">
              <label className="radio-option">
                <input
                  type="radio"
                  name="validityMode"
                  checked={validityMode === "timeout"}
                  onChange={() => selectValidityMode("timeout")}
                />
                Timeout
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="validityMode"
                  checked={validityMode === "timebound"}
                  onChange={() => selectValidityMode("timebound")}
                />
                Timebound
              </label>
            </div>

            {validityMode === "timeout" ? (
              <div className="validity-fields">
                <label htmlFor="tx-timeout">Timeout (seconds)</label>
                <input
                  id="tx-timeout"
                  type="number"
                  min={1}
                  step={1}
                  value={timeoutSeconds}
                  onChange={(e) => setTimeoutSeconds(e.target.value)}
                />
                <p className="meta">Default 300. Relative maxTime = now + timeout.</p>
              </div>
            ) : (
              <div className="validity-fields form-row">
                <div>
                  <label htmlFor="tb-start">Start (minTime)</label>
                  <input
                    id="tb-start"
                    type="datetime-local"
                    step={60}
                    value={tbStart}
                    onChange={(e) => setTbStart(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="tb-end">End (maxTime)</label>
                  <input
                    id="tb-end"
                    type="datetime-local"
                    step={60}
                    value={tbEnd}
                    onChange={(e) => setTbEnd(e.target.value)}
                  />
                </div>
                <p className="meta" style={{ gridColumn: "1 / -1" }}>
                  Defaults: start = now (minute floor), end = start + 60 minutes.
                  {tbMinUnix != null && tbMaxUnix != null
                    ? ` Unix: ${tbMinUnix} → ${tbMaxUnix}`
                    : ""}
                </p>
              </div>
            )}
          </div>

          <div className="row-actions invoke-actions">
            <button type="button" onClick={handleSubmit} disabled={invokeDisabled}>
              {invokeLabel}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleCopyXdr}
              disabled={invokeDisabled || !spec}
              title="Build simulated XDR and copy to clipboard for Signing tab"
            >
              {submitting ? "Working…" : "Copy XDR"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleSaveTemplate}
              disabled={templateDisabled || !spec}
              title={tauriAvailable ? "Save current parameters as template" : "Requires Tauri desktop app"}
            >
              {templateBusy ? "Saving…" : "Save Template"}
            </button>
          </div>
        </>
      )}

      {error && <div className="error">{error}</div>}
      {result && <div className="success" style={{ whiteSpace: "pre-wrap" }}>{result}</div>}
    </div>
  );
}
