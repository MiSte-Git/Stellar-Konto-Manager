import React, { useMemo, useState, useEffect, useRef } from 'react';
import { friendbotUrlFor, passphraseFor, readStoredNetworkId } from '../config/networks.js';
import { assertFlowNetwork, useGlobalNetwork } from '../utils/globalNetwork.js';
import { useTranslation } from 'react-i18next';
import SecretKeyModal from '../components/SecretKeyModal.jsx';
import MultiSigHelpDialog from '../components/multisig/MultiSigHelpDialog.jsx';
import MultisigConfigForm from '../components/multisig/MultisigConfigForm.jsx';
import { getHorizonServerForNetwork } from '../utils/stellar/stellarUtils.js';
import { getRequiredThreshold } from '../utils/getRequiredThreshold.js';
import { getMultisigSafetyCheck } from '../utils/getMultisigSafetyCheck.js';
import { useRecentWalletOptions } from '../utils/useRecentWalletOptions.js';
import { resolveFeePerOp } from '../utils/stellar/fees.js';
import { txHashHex } from '../utils/stellar/txHash.js';
import { classifyFriendbotResponse, classifyHorizonSubmitError, isAccountNotFoundError } from '../utils/stellar/activationOutcome.js';
import { copyText } from '../utils/clipboard.js';
import { useNavigationGuard } from '../utils/navigationGuard.js';
import { SESSION_LOCKED_EVENT } from '../utils/sessionSecrets.js';
import {
  Keypair,
  Operation,
  TransactionBuilder,
  Horizon
} from '@stellar/stellar-sdk';

// Friendbot ohne Antwort: nach dieser Zeit abbrechen und als unklaren Ausgang werten
export const FRIENDBOT_TIMEOUT_MS = 30000;


function NetworkSelector({ value, onChange }) {
  const { t } = useTranslation(['multisigCreate', 'network', 'common']);
  return (
    <div className="flex gap-4 mb-4">
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="network"
          value="PUBLIC"
          checked={value === 'PUBLIC'}
          onChange={() => onChange('PUBLIC')}
        />
        {t('network:mainnet')}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="network"
          value="TESTNET"
          checked={value === 'TESTNET'}
          onChange={() => onChange('TESTNET')}
        />
        {t('network:testnet')}
      </label>
    </div>
  );
}

export default function MultisigCreatePage() {
  const { t } = useTranslation(['multisigCreate', 'multisigConfig', 'network', 'common', 'createAccount']);

  // Der Schalter der Seite ist der globale Netzschalter (wie die Testnet-Checkbox
  // im Wallet-Kopf, der hier ausgeblendet ist) und folgt jedem Wechsel von anderer Stelle.
  const [network, setNetwork] = useGlobalNetwork();
  // { pub, sec, network }: network ist das Netz, fuer das die Schluessel erzeugt wurden
  const [generated, setGenerated] = useState(null);
  const [signers, setSigners] = useState(['']);
  const [signerCount, setSignerCount] = useState(1);

  const [enableMultisig, setEnableMultisig] = useState(false);
  const [activateNow, setActivateNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [error, setError] = useState('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'activate' | 'createAll'
  const [baseReserve, setBaseReserve] = useState(null); // XLM per entry
  const [startingBalance, setStartingBalance] = useState('1');
  const [showInfo2, setShowInfo2] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  // Pflicht vor jeder Aktivierung: Nutzer bestaetigt, dass er den angezeigten Secret Key
  // gesichert hat. Gilt nur fuer die aktuell angezeigten Schluessel.
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [secretVisible, setSecretVisible] = useState(true);
  const [secretCopy, setSecretCopy] = useState(''); // '' | 'ok' | 'failed'
  // Aktivierung der erzeugten Schluessel, sobald sie abgeschickt wurde (auch mit unklarem
  // Ausgang): { pub, network, hash, status: 'pending'|'success'|'ambiguous', multisigDone }.
  // Ab dann gehoeren die Schluessel zu einem (womoeglich gefuellten) Konto und duerfen beim
  // Netzwechsel nie verworfen werden. Ref fuer den Netzwechsel-Effekt (immer aktuell).
  // Ein gesetzter Vermerk wird durch einen spaeteren Versuch nie geloescht, nur durch
  // "Fertig, Key gesichert" oder nach Rueckfrage beim Erzeugen neuer Schluessel.
  const [activation, setActivationState] = useState(null);
  const activationRef = useRef(null);
  const setActivation = (next) => {
    const value = typeof next === 'function' ? next(activationRef.current) : next;
    activationRef.current = value;
    setActivationState(value);
  };
  const { recentWalletOptions, removeRecentWalletOption, clearRecentWalletOptions } = useRecentWalletOptions();

  // Server, Konto und Passphrase aus demselben Netz (getHorizonServer(Mainnet-URL) wuerde
  // das Netz erneut aus localStorage lesen).
  const server = useMemo(() => getHorizonServerForNetwork(network), [network]);
  const passphrase = passphraseFor(network);

  // Weights & thresholds
  const [masterWeight, setMasterWeight] = useState(1);
  const [signerWeights, setSignerWeights] = useState([1]); // aligned with signers
  const [lowT, setLowT] = useState(1);
  const [medT, setMedT] = useState(2);
  const [highT, setHighT] = useState(2);
  const thresholdsForModal = useMemo(() => ({
    low_threshold: Math.max(0, Number(lowT) || 0),
    med_threshold: Math.max(0, Number(medT) || 0),
    high_threshold: Math.max(0, Number(highT) || 0),
  }), [lowT, medT, highT]);
  const signersForModal = useMemo(() => {
    const master = generated?.pub ? [{ public_key: generated.pub, weight: Math.max(0, Number(masterWeight) || 0) }] : [];
    const others = (signers || []).map((s, idx) => ({
      public_key: (s || '').trim(),
      weight: Math.max(0, Number(signerWeights[idx] ?? 0) || 0)
    })).filter((s) => !!s.public_key);
    return [...master, ...others];
  }, [generated?.pub, masterWeight, signers, signerWeights]);
  const requiredThreshold = useMemo(
    () => getRequiredThreshold('setOptions', thresholdsForModal),
    [thresholdsForModal]
  );

  // Helper: clamp to byte range 0..255 and coerce to integer
  function clampByte(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(255, Math.trunc(v)));
  }
  function handleMasterWeightChange(val) {
    setMasterWeight(clampByte(val));
  }
  function handleThresholdChange(kind, val) {
    const v = clampByte(val);
    if (kind === 'low') setLowT(v);
    else if (kind === 'med') setMedT(v);
    else if (kind === 'high') setHighT(v);
  }

  const sumWeights = useMemo(() => {
    const mw = Math.max(0, Number(masterWeight) || 0);
    const sw = (signerWeights || []).reduce((a, b) => a + Math.max(0, Number(b) || 0), 0);
    return mw + sw;
  }, [masterWeight, signerWeights]);

  const thLowErr = lowT > sumWeights;
  const thMedErr = medT > sumWeights;
  const thHighErr = highT > sumWeights;
  const plannedSigners = useMemo(() => (
    (signers || []).map((s, idx) => ({
      key: (s || '').trim(),
      weight: Math.max(0, Number(signerWeights[idx] ?? 0) || 0),
    }))
  ), [signers, signerWeights]);
  const safetyCheck = useMemo(() => {
    if (!enableMultisig) return { errors: [], warnings: [] };
    return getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: generated?.pub || '',
      masterWeight,
      signers: plannedSigners,
      thresholds: {
        low: lowT,
        med: medT,
        high: highT,
      },
    });
  }, [enableMultisig, generated?.pub, highT, lowT, masterWeight, medT, plannedSigners, t]);
  const hasSafetyErrors = enableMultisig && safetyCheck.errors.length > 0;

  // Nach einem Netzwechsel (egal von wo) Reserve des neuen Netzes laden und das
  // Startguthaben vorschlagen. Vorher lief das nur beim Klick auf den Schalter der
  // Seite, und zwar noch gegen den Server des alten Netzes. Beim Oeffnen der Seite
  // bleibt es wie bisher (Startguthaben 1, Reserve-Fallback).
  const planRef = useRef({ enableMultisig: false, signerCount: 1 });
  planRef.current = { enableMultisig, signerCount };
  const lastNetworkRef = useRef(network);
  const networkRef = useRef(network);
  networkRef.current = network;
  const generatedRef = useRef(generated);
  generatedRef.current = generated;
  const [networkNotice, setNetworkNotice] = useState('');
  // Nach dem Aushaengen darf kein laufender Ablauf mehr senden (KS-1): Der Waechter haelt
  // die Seite, falls sie trotzdem ausgehaengt wird, bricht jeder Ablauf vor dem Senden ab.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      generatedRef.current = null;
    };
  }, []);

  // Schluessel samt abhaengiger Eingaben verwerfen. Nur nach einer ausdruecklichen Handlung
  // des Nutzers aufrufen ("Fertig, Key gesichert", "Schluessel verwerfen", neue Schluessel).
  function discardKeys(notice) {
    generatedRef.current = null;
    setGenerated(null);
    setEnableMultisig(false);
    setActivateNow(false);
    setSigners(['']);
    setSignerCount(1);
    setSignerWeights([1]);
    setMasterWeight(1);
    setLowT(1);
    setMedT(2);
    setHighT(2);
    setShowSecretModal(false);
    setPendingAction(null);
    setBackupConfirmed(false);
    setSecretVisible(true);
    setSecretCopy('');
    setResultMsg('');
    setError('');
    setNetworkNotice(notice);
  }

  // Hinweis zu erzeugten Schluesseln im gewaehlten Netz: leer im Netz der Schluessel, sonst
  // mit Vermerk "Aktivierung gesendet", ohne Vermerk "zurueckwechseln oder verwerfen".
  function keysNetworkNotice(keys, net) {
    if (!keys || keys.network === net) return '';
    const sent = activationRef.current;
    return sent && sent.pub === keys.pub
      ? t('createAccount:networkChanged.keptActivated', { network: networkName(keys.network) })
      : t('createAccount:networkChanged.keptKeys', { network: networkName(keys.network), current: networkName(net) });
  }

  useEffect(() => {
    if (lastNetworkRef.current === network) return undefined;
    lastNetworkRef.current = network;
    const keys = generatedRef.current;
    if (keys) {
      // Erzeugte Schluessel verschwinden nie automatisch, auch ohne Aktivierung nicht: Sie
      // bleiben mit dem Netz, fuer das sie erzeugt wurden. Aktivieren und Multisig sind
      // gesperrt, solange ein anderes Netz gewaehlt ist. Eine offene Funder-Abfrage gehoert
      // zum alten Netz und wird geschlossen.
      setShowSecretModal(false);
      setPendingAction(null);
      setNetworkNotice(keysNetworkNotice(keys, network));
    }
    let cancelled = false;
    (async () => {
      const r = await fetchBaseReserveXLM();
      if (cancelled) return;
      setBaseReserve(r);
      if (network === 'PUBLIC') {
        const { enableMultisig: ms, signerCount: n } = planRef.current;
        const planned = ms ? Math.max(0, Number(n) || 0) : 0;
        setStartingBalance(Math.max(r * (2 + planned) + 0.5, 1).toFixed(7));
      } else {
        setStartingBalance('1');
      }
    })();
    return () => { cancelled = true; };
    // fetchBaseReserveXLM liest server, der sich nur mit network aendert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  // Sync signers length with selected count (and weights too)
  useEffect(() => {
    setSigners(prev => {
      const n = Math.max(0, Number(signerCount) || 0);
      if (prev.length === n) return prev;
      if (prev.length < n) return [...prev, ...Array.from({ length: n - prev.length }, () => '')];
      return prev.slice(0, n);
    });
    setSignerWeights(prev => {
      const n = Math.max(0, Number(signerCount) || 0);
      if (prev.length === n) return prev;
      if (prev.length < n) return [...prev, ...Array.from({ length: n - prev.length }, () => 1)];
      return prev.slice(0, n);
    });
  }, [signerCount]);

  function handleSignerChange(i, val) {
    const arr = [...signers];
    arr[i] = val.trim();
    setSigners(arr);
  }
  function handleSignerWeightChange(i, val) {
    const w = Math.max(0, Math.min(255, Number(val) || 0));
    const arr = [...signerWeights];
    arr[i] = w;
    setSignerWeights(arr);
  }
  function handleSignerCountChange(val) {
    setSignerCount(Math.max(1, Math.min(20, Number(val) || 1)));
  }

  function networkName(net) {
    return net === 'TESTNET' ? t('network:testnet') : t('network:mainnet');
  }

  // Vermerk fuer genau diese Schluessel, sonst null
  function recordFor(pub) {
    const cur = activationRef.current;
    return cur && pub && cur.pub === pub ? cur : null;
  }

  // Merkt die Aktivierung vor dem Absenden. Liefert den vorherigen Vermerk: Eine eindeutige
  // Ablehnung stellt ihn wieder her, ein schon gesetzter Vermerk wird so nie geloescht.
  function markActivationSent(pub, hash) {
    const prev = recordFor(pub);
    setActivation(prev
      ? { ...prev, hash: prev.hash || hash || '' }
      : { pub, network, hash: hash || '', status: 'pending', multisigDone: false });
    return prev;
  }
  // outcome: 'success' | 'exists' | 'ambiguous' | 'rejected'
  function markActivationOutcome(pub, outcome, { hash = '', prev = null } = {}) {
    const cur = recordFor(pub);
    if (!cur) return; // Schluessel inzwischen ersetzt
    if (outcome === 'rejected') {
      setActivation(prev);
      // Eindeutig abgelehnt, waehrend schon ein anderes Netz gewaehlt ist: Schluessel bleiben
      // (gesperrt bis zum Rueckwechsel), der Hinweis gilt dann fuer Schluessel ohne Aktivierung.
      const keys = generatedRef.current;
      if (keys && keys.pub === pub) setNetworkNotice(keysNetworkNotice(keys, networkRef.current));
      return;
    }
    if (outcome === 'exists') {
      // Konto gab es schon: der Hash dieses Versuchs gehoert zu keiner erfolgreichen Transaktion
      setActivation({ ...cur, status: 'success', hash: prev?.hash || '' });
      return;
    }
    const status = outcome === 'success' || cur.status === 'success' ? 'success' : 'ambiguous';
    setActivation({ ...cur, status, hash: hash || cur.hash });
  }

  // Live im Netz der Seite: 'exists' | 'missing' | 'unknown'
  async function checkAccountLive(pub) {
    try {
      await server.loadAccount(pub);
      return 'exists';
    } catch (e) {
      return isAccountNotFoundError(e) ? 'missing' : 'unknown';
    }
  }

  // Vor jedem Aktivieren: Existiert das Konto schon, als aktiviert werten und nichts senden.
  // Gibt es einen Vermerk, das Konto ist aber (noch) nicht sichtbar, nicht erneut senden.
  // Rueckgabe: 'exists' | 'blocked' | 'send'
  async function prepareActivation(pub) {
    const rec = recordFor(pub);
    const live = await checkAccountLive(pub);
    if (live === 'exists') {
      const cur = recordFor(pub);
      setActivation(cur
        ? { ...cur, status: 'success' }
        : { pub, network, hash: '', status: 'success', multisigDone: false });
      return 'exists';
    }
    if (rec) return 'blocked';
    return 'send';
  }

  // Direkt vor dem Senden: Seite noch gemountet, Netz noch das des Ablaufs, Schluessel
  // noch dieselben?
  function assertStillSendable(pub, abortMessage) {
    if (!aliveRef.current) throw new Error(abortMessage);
    assertFlowNetwork(network, abortMessage);
    if (generatedRef.current?.pub !== pub) throw new Error(abortMessage);
  }

  // Schritte fuer die erzeugten Schluessel (Aktivieren, Multisig) nur im Netz, fuer das
  // sie erzeugt wurden.
  const networkLocked = !!generated && generated.network !== network;
  // Offener Zustand: Vermerk gesetzt, Nutzer hat noch nicht "Fertig, Key gesichert" gewaehlt.
  const keyMustStay = !!activation && !!generated && activation.pub === generated.pub;
  const activationLocked = keyMustStay && networkLocked;
  // Waechter ab dem Erzeugen (KS-1, KS-2): Die Adresse kann schon Guthaben haben (eigene
  // Aktivierung laeuft oder Zahlung von aussen). Er endet erst mit "Fertig, Key gesichert"
  // oder "Schluessel verwerfen".
  useNavigationGuard(!!generated, keyMustStay
    ? t('multisigCreate:leaveGuard.confirm')
    : t('multisigCreate:leaveGuard.confirmKeys'));

  function handleGenerate() {
    if (busy) return;
    // Angezeigte Schluessel nie ohne Rueckfrage ersetzen: Die Adresse kann schon Guthaben
    // haben, mit gesendeter Aktivierung erst recht.
    if (generated) {
      const message = recordFor(generated.pub)
        ? t('multisigCreate:activation.replaceConfirm')
        : t('multisigCreate:keys.replaceConfirm');
      if (!window.confirm(message)) return;
    }
    setActivation(null);
    const kp = Keypair.random();
    const next = { pub: kp.publicKey(), sec: kp.secret(), network };
    generatedRef.current = next;
    setGenerated(next);
    setBackupConfirmed(false);
    setSecretVisible(true);
    setSecretCopy('');
    setNetworkNotice('');
    setResultMsg('');
    setError('');
  }

  // Sitzungssperre (Schloss, Inaktivitaets-Timeout): angezeigte Secret Keys nur verbergen,
  // nicht verwerfen. Schluessel, Vermerk und Navigationswaechter bleiben, "Anzeigen" zeigt sie wieder.
  useEffect(() => {
    const hideSecret = () => setSecretVisible(false);
    window.addEventListener(SESSION_LOCKED_EVENT, hideSecret);
    return () => window.removeEventListener(SESSION_LOCKED_EVENT, hideSecret);
  }, []);

  // "Fertig, Key gesichert": beendet den offenen Zustand, die Schluessel verschwinden.
  function handleFinish() {
    if (busy) return;
    setActivation(null);
    discardKeys('');
    setResultMsg(t('multisigCreate:activation.finished'));
  }

  // "Schluessel verwerfen": ausdruecklich, mit Rueckfrage. Waehrend busy gesperrt, damit ein
  // laufender Ablauf nicht ohne Key zu Ende geht.
  function handleDiscardKeys() {
    if (busy || !generated) return;
    if (!window.confirm(t('multisigCreate:keys.discardConfirm'))) return;
    setActivation(null);
    discardKeys('');
    setResultMsg(t('multisigCreate:keys.discarded'));
  }

  async function handleCopySecret() {
    if (!generated?.sec) return;
    const ok = await copyText(generated.sec);
    setSecretCopy(ok ? 'ok' : 'failed');
  }

  // Rueckgabe 'success' | 'exists'; unklar oder abgelehnt wirft.
  async function friendbotActivate(pub) {
    const url = `${friendbotUrlFor(network)}?addr=${encodeURIComponent(pub)}`;
    assertStillSendable(pub, t('createAccount:networkChanged.funderAborted'));
    const prev = markActivationSent(pub, '');
    // KS-4: ohne Antwort nach FRIENDBOT_TIMEOUT_MS abbrechen (unklarer Ausgang)
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FRIENDBOT_TIMEOUT_MS) : null;
    let r;
    let body = '';
    try {
      try {
        r = await fetch(url, controller ? { signal: controller.signal } : undefined);
      } catch (e) {
        // Keine Antwort: Ausgang unklar, Schluessel behalten
        markActivationOutcome(pub, 'ambiguous', { prev });
        if (controller?.signal.aborted) {
          throw new Error(t('multisigCreate:activation.friendbotTimeout', { seconds: Math.round(FRIENDBOT_TIMEOUT_MS / 1000) }));
        }
        throw e;
      }
      body = await r.text().catch(() => '');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let outcome = classifyFriendbotResponse(r.status, body);
    if (outcome === 'rejected') {
      // Gegenprobe: abgelehnt nur, wenn das Konto im Netz wirklich nicht existiert
      const live = await checkAccountLive(pub);
      outcome = live === 'exists' ? 'exists' : live === 'missing' ? 'rejected' : 'ambiguous';
    }
    if (outcome === 'success' || outcome === 'exists') {
      let data = {};
      try { data = JSON.parse(body) || {}; } catch { /* kein JSON */ }
      markActivationOutcome(pub, outcome, { hash: data?.hash || data?.id || '', prev });
      return outcome;
    }
    markActivationOutcome(pub, outcome, { prev });
    throw new Error(outcome === 'rejected'
      ? t('multisigCreate:activation.friendbotRejected', { status: r.status })
      : t('multisigCreate:activation.friendbotUnclear', { status: r.status }));
  }

  // Load base reserve from latest ledger (in XLM)
  async function fetchBaseReserveXLM() {
    try {
      const ledgers = await server.ledgers().order('desc').limit(1).call();
      const latest = ledgers.records?.[0];
      const stroops = Number(latest?.base_reserve_in_stroops || 5000000);
      return stroops / 10000000; // 10^7 stroops per XLM
    } catch {
      return 0.5; // fallback
    }
  }

  async function getBaseFee(server) {
    return Number(await resolveFeePerOp(server));
  }

  async function activateWithFunderSecret(funderSecret, destPub, startingBalanceXLM = '1') {
    const funder = Keypair.fromSecret(funderSecret);
    const funderPub = funder.publicKey();
    const account = await server.loadAccount(funderPub);
    const tx = new TransactionBuilder(account, {
      fee: String(await getBaseFee(server)),
      networkPassphrase: passphrase
    })
      .addOperation(
        Operation.createAccount({ destination: destPub, startingBalance: String(startingBalanceXLM || '1') })
      )
      .setTimeout(60)
      .build();
    // Zwischen Bestaetigen und hier liegen Horizon-Aufrufe: Netz und Schluessel noch die des Ablaufs?
    assertStillSendable(destPub, t('createAccount:networkChanged.funderAborted'));
    tx.sign(funder);
    // Ab hier kann das Konto existieren: vor dem Absenden merken (unklarer Ausgang zaehlt wie gesendet).
    const hash = txHashHex(tx);
    const prev = markActivationSent(destPub, hash);
    let res;
    try {
      res = await server.submitTransaction(tx);
    } catch (e) {
      const kind = classifyHorizonSubmitError(e);
      markActivationOutcome(destPub, kind, { prev });
      // Konto existiert schon (z. B. frueherer Versuch doch angekommen): als aktiviert werten
      if (kind === 'exists') return { hash: '', existed: true };
      throw e;
    }
    const finalHash = res?.hash || res?.id || hash;
    markActivationOutcome(destPub, 'success', { hash: finalHash, prev });
    return { hash: finalHash, existed: false };
  }

  // abortMessage: Text, falls das Netz vor dem Signieren gewechselt hat (nach einer schon
  // erfolgten Aktivierung ein anderer als ohne).
  async function setMultisigOnNewAccount(newSecret, { abortMessage = t('createAccount:networkChanged.funderAborted') } = {}) {
    const newKp = Keypair.fromSecret(newSecret);
    const newPub = newKp.publicKey();

    // Filter gültige zusätzliche Signer (G...)
    const validSigners = (signers || [])
      .map((s) => s.trim())
      .filter((s) => s && s.startsWith('G') && s.length >= 10);

    if (validSigners.length === 0) {
      // Nichts zu tun
      return { hash: null, skipped: true };
    }

    const acct = await server.loadAccount(newPub);
    const txb = new TransactionBuilder(acct, {
      fee: String(await getBaseFee(server)),
      networkPassphrase: passphrase
    });

    // 1) Master-Weight & Schwellen setzen
    txb.addOperation(
      Operation.setOptions({
        masterWeight: Math.max(0, Math.min(255, Number(masterWeight) || 0)),
        lowThreshold: Math.max(0, Math.min(255, Number(lowT) || 0)),
        medThreshold: Math.max(0, Math.min(255, Number(medT) || 0)),
        highThreshold: Math.max(0, Math.min(255, Number(highT) || 0)),
      })
    );
    // 2) Zusätzliche Unterzeichner hinzufügen (jeweils mit Gewicht)
    validSigners.forEach((s, idx) => {
      const w = Math.max(0, Math.min(255, Number(signerWeights[idx]) || 0));
      txb.addOperation(
        Operation.setOptions({ signer: { ed25519PublicKey: s, weight: w } })
      );
    });

    const tx = txb.setTimeout(60).build();
    assertStillSendable(newPub, abortMessage);
    tx.sign(newKp);
    const res = await server.submitTransaction(tx);
    setActivation((prev) => (prev && prev.pub === newPub ? { ...prev, multisigDone: true } : prev));
    return { hash: res?.hash || res?.id || '' };
  }

  // Multisig fuer ein schon aktiviertes Konto nachholen (z. B. nach einem Netzwechsel
  // zwischen Aktivierung und Multisig-Schritt). Nur im Netz der Aktivierung.
  async function handleSetMultisigOnly() {
    if (busy || !generated?.sec || !activation || activation.pub !== generated.pub) return;
    if (networkLocked) {
      setError(t('multisigCreate:activation.otherNetwork', { network: networkName(activation.network), current: networkName(network) }));
      return;
    }
    if (hasSafetyErrors) {
      setError(t('common:multisigEdit.error.safetyBlocked'));
      return;
    }
    setBusy(true);
    setResultMsg('');
    setError('');
    try {
      const setRes = await setMultisigOnNewAccount(generated.sec, { abortMessage: t('createAccount:networkChanged.stoppedAfterPartial') });
      setResultMsg(setRes.skipped
        ? t('multisigCreate:createdNoSigners')
        : t('multisigCreate:createdAndConfigured', { hash: setRes.hash || '' }));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }


  async function handleConfirmSecret(collectedSigners) {
    const funderSecret = collectedSigners?.[0]?.keypair?.secret?.() || '';
    setShowSecretModal(false);
    if (!pendingAction) return;
    const { type, destPub, startingBalance, network: startedOn } = pendingAction;
    setPendingAction(null);
    // Netz muss noch dasselbe sein wie beim Oeffnen des Dialogs (auch laut
    // gespeichertem globalem Netz), sonst nichts senden.
    if (startedOn !== network || readStoredNetworkId() !== startedOn) {
      setResultMsg('');
      setError(t('createAccount:networkChanged.funderAborted'));
      return;
    }

    try {
      setBusy(true);
      setError('');
      if (type === 'activate') {
        const { hash, existed } = await activateWithFunderSecret(funderSecret, destPub, startingBalance || '1');
        setResultMsg(existed ? t('multisigCreate:alreadyActive') : t('multisigCreate:activated', { hash }));
      } else if (type === 'createAll') {
        // 1) Aktivieren
        await activateWithFunderSecret(funderSecret, destPub, startingBalance || '1');
        // 2) Multisig setzen
        const setRes = await setMultisigOnNewAccount(generated.sec, { abortMessage: t('createAccount:networkChanged.stoppedAfterPartial') });
        setResultMsg(
          t('multisigCreate:createdAndConfigured', { hash: setRes.hash || '' })
        );
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Gemeinsame Voraussetzungen fuer Erstellen und Nur aktivieren. Rueckgabe: Fehlertext oder ''.
  function sendPrecheckError() {
    if (!generated?.pub || !generated?.sec) return t('multisigCreate:generateFirst');
    if (networkLocked) {
      return keyMustStay
        ? t('multisigCreate:activation.otherNetwork', { network: networkName(generated.network), current: networkName(network) })
        : t('multisigCreate:keys.otherNetwork', { network: networkName(generated.network), current: networkName(network) });
    }
    if (!backupConfirmed) return t('multisigCreate:backup.required');
    return '';
  }

  function confirmLowBalanceIfNeeded() {
    if (network !== 'PUBLIC') return true;
    const bal = parseFloat(startingBalance || '0');
    if (bal >= requiredReserve) return true;
    return window.confirm(t('multisigCreate:confirmLowBalance', { bal: bal.toFixed(7), req: requiredReserve.toFixed(7), count: Math.max(0, Number(signerCount)||0) }));
  }

  async function handleCreateAll() {
    const precheck = sendPrecheckError();
    if (precheck) {
      setError(precheck);
      return;
    }
    if (enableMultisig && hasSafetyErrors) {
      setError(t('common:multisigEdit.error.safetyBlocked'));
      return;
    }
    const { pub, sec } = generated;
    setBusy(true);
    setResultMsg('');
    setError('');
    try {
      // 1) Aktivieren (optional). Vermerk mit Erfolg: nur noch Multisig setzen. Sonst live
      // pruefen: Konto da -> aktiviert; Vermerk ohne sichtbares Konto -> nicht erneut senden.
      const rec = recordFor(pub);
      let activated = rec?.status === 'success';
      if (!activated && (activateNow || rec)) {
        const prep = await prepareActivation(pub);
        if (prep === 'blocked') {
          setError(t('multisigCreate:activation.stillUnclear'));
          return;
        }
        activated = prep === 'exists';
      }
      if (activateNow && !activated) {
        if (network === 'TESTNET') {
          await friendbotActivate(pub);
          activated = true;
        } else {
          // Warn-Confirm bei zu geringem Startguthaben im Mainnet
          if (!confirmLowBalanceIfNeeded()) return;
          // Mainnet → Secret vom Funder anfragen und danach fortsetzen
          setPendingAction({ type: 'createAll', destPub: pub, startingBalance, network });
          setShowSecretModal(true);
          return; // Warten auf Modal
        }
      }

      // 2) Multisig setzen (falls Signer vorhanden)
      const setRes = await setMultisigOnNewAccount(sec, activated
        ? { abortMessage: t('createAccount:networkChanged.stoppedAfterPartial') }
        : undefined);
      if (setRes.skipped) {
        setResultMsg(t('multisigCreate:createdNoSigners'));
      } else {
        setResultMsg(t('multisigCreate:createdAndConfigured', { hash: setRes.hash || '' }));
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateOnly() {
    const precheck = sendPrecheckError();
    if (precheck) {
      setError(precheck);
      return;
    }
    const { pub } = generated;
    try {
      setBusy(true);
      setResultMsg('');
      setError('');
      // Live pruefen: Konto da -> aktiviert, nichts senden (N21-1). Vermerk (gesendet oder
      // unklar) ohne sichtbares Konto -> kein zweiter Versand.
      const prep = await prepareActivation(pub);
      if (prep === 'exists') {
        setResultMsg(t('multisigCreate:alreadyActive'));
        return;
      }
      if (prep === 'blocked') {
        setError(t('multisigCreate:activation.stillUnclear'));
        return;
      }
      if (network === 'TESTNET') {
        const outcome = await friendbotActivate(pub);
        setResultMsg(outcome === 'exists' ? t('multisigCreate:alreadyActive') : t('multisigCreate:activatedTestnet'));
      } else {
        if (!confirmLowBalanceIfNeeded()) return;
        setPendingAction({ type: 'activate', destPub: pub, startingBalance, network });
        setShowSecretModal(true);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Anzahl bereits gültiger (eingegebener) Signer – aktuell nur für Validierungen verwendet
  // const validSignerCount = (signers || []).filter((s) => s && s.trim().startsWith('G')).length;


  // derive reserve numbers
  const requiredReserve = useMemo(() => {
    const base = Number(baseReserve || 0.5);
    const plannedSignerCount = enableMultisig ? Math.max(0, Number(signerCount) || 0) : 0;
    const min = base * (2 + plannedSignerCount);
    return Number.isFinite(min) ? min : 1;
  }, [baseReserve, enableMultisig, signerCount]);
  const recommended = useMemo(() => {
    // add small buffer (e.g., +0.5 XLM)
    return Math.max(requiredReserve + 0.5, 1);
  }, [requiredReserve]);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-semibold">{t('multisigCreate:title')}</h2>
      </div>

      {/* Info-Button ganz oben */}
      <div className="mb-4 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={()=>setShowInfo2(true)} className="px-4 py-2 rounded-sm bg-blue-600 text-white hover:bg-blue-700">
            {t('multisigCreate:info.more')}
          </button>
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            className="px-4 py-2 rounded-sm border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
          >
            {t('glossary:multisig.help.linkLabel', 'Was bedeutet Multi-Signature?')}
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{t('multisigCreate:hint')}</p>

      <NetworkSelector value={network} onChange={setNetwork} />
      {networkNotice && (
        <p data-testid="create-network-notice" className="mb-4 text-sm text-amber-800 dark:text-amber-200 border border-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-sm p-2">
          {networkNotice}
        </p>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-sm border p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button onClick={handleGenerate} className="bg-blue-600 text-white px-3 py-2 rounded-sm hover:bg-blue-700" disabled={busy}>
            {t('multisigCreate:generateKeys')}
          </button>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enableMultisig} onChange={()=>setEnableMultisig(v=>!v)} />
            {t('multisigCreate:enableMultisig')}
          </label>
        </div>
        {generated && (
          <div className="space-y-2">
            <div>
              <label className="block text-sm font-semibold">Public Key</label>
              <div className="font-mono break-all text-sm">{generated.pub}</div>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:instructions.public')}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold">Secret Key</label>
              <div className="font-mono break-all text-sm" data-testid="create-secret">
                {secretVisible ? generated.sec : '•'.repeat(generated.sec.length)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="create-secret-copy"
                  onClick={handleCopySecret}
                  className="rounded-sm border px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t('multisigCreate:secretKey.copy')}
                </button>
                <button
                  type="button"
                  data-testid="create-secret-toggle"
                  onClick={() => setSecretVisible((v) => !v)}
                  className="rounded-sm border px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {secretVisible ? t('multisigCreate:secretKey.hide') : t('multisigCreate:secretKey.show')}
                </button>
                {secretCopy && (
                  <span data-testid="create-secret-copy-status" className={`text-xs ${secretCopy === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
                    {secretCopy === 'ok' ? t('multisigCreate:secretKey.copied') : t('multisigCreate:secretKey.copyFailed')}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:instructions.secret')}</p>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300" data-testid="create-keys-network">
              {t('multisigCreate:keys.network', { network: networkName(generated.network) })}
            </p>
            {networkLocked && !keyMustStay && (
              <p data-testid="create-keys-locked" className="text-sm text-amber-800 dark:text-amber-200">
                {t('multisigCreate:keys.otherNetwork', { network: networkName(generated.network), current: networkName(network) })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="create-keys-discard"
                onClick={handleDiscardKeys}
                disabled={busy}
                className="rounded-sm border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
              >
                {t('multisigCreate:keys.discard')}
              </button>
              <span className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:keys.leaveHint')}</span>
            </div>
          </div>
        )}
      </div>

      {activation && generated && activation.pub === generated.pub && (
        <div data-testid="create-activation" className="mb-4 rounded-sm border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          <p className="font-semibold">{t('multisigCreate:activation.title', { network: networkName(activation.network) })}</p>
          <p className="mt-1">
            {activation.status === 'success'
              ? t('multisigCreate:activation.statusSuccess')
              : t('multisigCreate:activation.statusAmbiguous')}
          </p>
          <div className="mt-1 font-mono break-all text-xs" data-testid="create-activation-pub">{activation.pub}</div>
          {activation.hash && (
            <div className="mt-1 font-mono break-all text-xs" data-testid="create-activation-hash">
              {t('multisigCreate:activation.hash')}: {activation.hash}
            </div>
          )}
          <p className="mt-2 font-semibold" data-testid="create-activation-backup">{t('multisigCreate:activation.backupNow')}</p>
          {activationLocked && (
            <p className="mt-2" data-testid="create-activation-locked">
              {t('multisigCreate:activation.otherNetwork', { network: networkName(activation.network), current: networkName(network) })}
            </p>
          )}
          {!activationLocked && enableMultisig && !activation.multisigDone && (
            <button
              type="button"
              data-testid="create-activation-set-multisig"
              onClick={handleSetMultisigOnly}
              disabled={busy || thLowErr || thMedErr || thHighErr || hasSafetyErrors}
              className="mt-3 rounded-sm bg-green-600 px-3 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {t('multisigCreate:activation.setMultisigNow')}
            </button>
          )}
          <p className="mt-3 text-xs" data-testid="create-activation-leave-hint">{t('multisigCreate:activation.leaveHint')}</p>
          <button
            type="button"
            data-testid="create-activation-finish"
            onClick={handleFinish}
            disabled={busy}
            className="mt-2 rounded-sm border border-amber-400 bg-white px-3 py-2 text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:bg-gray-800 dark:text-amber-100 dark:hover:bg-gray-700"
          >
            {t('multisigCreate:activation.finish')}
          </button>
        </div>
      )}

      {enableMultisig && generated && (
        <div className="bg-white dark:bg-gray-800 rounded-sm border p-4 mb-4">
          <MultisigConfigForm
            signersTitle={t('multisigConfig:signersTitle')}
            titleAs="h3"
            titleClassName="font-semibold mb-2"
            showBestPractices
            bestPracticesTitle={t('multisigConfig:bestPractices.title')}
            bestPracticesText={t('multisigConfig:bestPractices.text')}
            signersInfo={t('multisigConfig:signersInfo')}
            signerWeightHeaderLabel={t('common:multisigEdit.weight', 'Gewicht')}
            showSignerCount
            signerCount={signerCount}
            signerCountMin={1}
            signerCountMax={20}
            onSignerCountChange={handleSignerCountChange}
            signerCountLabel={t('multisigConfig:signersCount')}
            signerCountLimitLabel={t('multisigConfig:signersCountLimit')}
            signerCountLimitTitle={t('multisigConfig:signersCountLimit')}
            signers={plannedSigners}
            signerOptions={recentWalletOptions}
            onRemoveSignerOption={removeRecentWalletOption}
            onClearSignerOptions={clearRecentWalletOptions}
            signerPlaceholder="G..."
            onSignerKeyChange={handleSignerChange}
            onSignerWeightChange={handleSignerWeightChange}
            signerWeightTooltip={t('multisigConfig:tooltips.signerWeight')}
            signerWeightHint={t('multisigConfig:hints.byteRange')}
            showSignerWeightInfo
            signerWeightInputClassName="border rounded-sm px-2 py-1 text-sm w-20"
            masterWeight={masterWeight}
            onMasterWeightChange={handleMasterWeightChange}
            masterWeightLabel={t('multisigConfig:masterWeight')}
            masterWeightHint={t('multisigConfig:hints.byteRange')}
            masterWeightTooltip={t('multisigConfig:tooltips.masterWeight')}
            showMasterWeightInfo
            masterWeightInputClassName="border rounded-sm px-2 py-1 text-sm w-24"
            thresholdsLabel={t('multisigConfig:threshold')}
            thresholdLabels={{
              low: t('multisigConfig:thresholdLow'),
              med: t('multisigConfig:thresholdMed'),
              high: t('multisigConfig:thresholdHigh'),
            }}
            thresholdTooltips={{
              low: t('multisigConfig:tooltips.low'),
              med: t('multisigConfig:tooltips.med'),
              high: t('multisigConfig:tooltips.high'),
            }}
            thresholdValues={{ low: lowT, med: medT, high: highT }}
            thresholdErrors={{ low: thLowErr, med: thMedErr, high: thHighErr }}
            onThresholdChange={handleThresholdChange}
            thresholdInputClassName="border rounded-sm px-2 py-1 w-16"
            thresholdUnitsLabel={t('multisigConfig:units.signatures')}
            thresholdLevelsHint={t('multisigConfig:thresholdLevelsHint')}
            thresholdSumText={t('multisigConfig:thresholdSum', { sum: sumWeights })}
            thresholdTooHighText={t('multisigConfig:thresholdTooHigh')}
            safetyErrors={safetyCheck.errors}
            safetyWarnings={safetyCheck.warnings}
            safetyErrorTitle={t('multisigConfig:safety.errorTitle')}
            safetyWarningTitle={t('multisigConfig:safety.warningTitle')}
          />
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-sm border p-4 mb-4">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={activateNow} onChange={() => setActivateNow(!activateNow)} />
          <span>
            <span className="font-semibold">{t('multisigCreate:activateNow')}</span>
            <br />
            <span className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:activateHint')}</span>
          </span>
        </label>
        {network === 'PUBLIC' && activateNow && (
          <>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold mb-1">{t('multisigCreate:startingBalance')}</label>
                <input
                  type="number"
                  step="0.0000001"
                  min="0"
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  className="w-full border rounded-sm px-2 py-1"
                />
                {parseFloat(startingBalance || '0') < requiredReserve && (
                  <p className="text-xs text-red-600 mt-1">
                    {t('multisigCreate:balanceWarning', { req: requiredReserve.toFixed(7), count: Math.max(0, Number(signerCount)||0) })}
                  </p>
                )}
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300">
                <div>{t('multisigCreate:reserve.base', { val: (baseReserve ?? 0.5).toFixed(7) })}</div>
                <div className={(parseFloat(startingBalance || '0') < requiredReserve) ? 'font-semibold text-red-700 dark:text-red-400' : 'font-semibold'}>{t('multisigCreate:reserve.required', { val: requiredReserve.toFixed(7) })}</div>
                <div>{t('multisigCreate:reserve.recommended', { val: recommended.toFixed(7) })}</div>
              </div>
            </div>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-2">
              {t('multisigCreate:mainnetActivateNote')}
            </p>
          </>
        )}
      </div>

      {generated && (
        <div data-testid="create-backup" className="mb-4 rounded-sm border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100">
          <p className="font-semibold">{t('multisigCreate:keyWarning.title')}</p>
          <ul className="mt-2 list-disc list-inside space-y-1 text-xs">
            <li>{t('multisigCreate:keyWarning.list1')}</li>
            <li>{t('multisigCreate:keyWarning.list2')}</li>
            <li>{t('multisigCreate:keyWarning.list3')}</li>
          </ul>
          <label className="mt-3 flex items-start gap-2 font-semibold">
            <input
              type="checkbox"
              data-testid="create-backup-confirm"
              checked={backupConfirmed}
              onChange={() => setBackupConfirmed((v) => !v)}
            />
            <span>{t('multisigCreate:backup.confirm')}</span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={handleCreateAll} disabled={busy || !backupConfirmed || networkLocked || (enableMultisig && (thLowErr || thMedErr || thHighErr || hasSafetyErrors))} className="bg-green-600 text-white px-4 py-2 rounded-sm hover:bg-green-700 disabled:opacity-50">
          {t('multisigCreate:createButton')}
        </button>
        <button onClick={handleActivateOnly} disabled={busy || !backupConfirmed || networkLocked} className="px-4 py-2 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
          {t('multisigCreate:activateOnly')}
        </button>
      </div>

      {resultMsg && <p className="mt-4 text-green-700 dark:text-green-400 text-sm">{resultMsg}</p>}
      {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}

      {showSecretModal && (
        <SecretKeyModal
          onConfirm={handleConfirmSecret}
          onCancel={() => { setShowSecretModal(false); setPendingAction(null); }}
          thresholds={thresholdsForModal}
          signers={signersForModal}
          operationType="setOptions"
          requiredThreshold={requiredThreshold}
          account={{ signers: signersForModal, thresholds: thresholdsForModal }}
        />
      )}

      {showInfo2 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded-sm p-6 max-w-3xl w-full mx-auto my-8">
            <h3 className="text-xl font-bold mb-4">{t('multisigCreate:info.title')}</h3>
            
            <div className="space-y-4 text-sm">
              {/* Geheimschlüssel sichern */}
              <div>
                <h4 className="font-bold mb-2">{t('multisigCreate:info.secureKeys.title')}</h4>
                <p className="whitespace-pre-line text-gray-700 dark:text-gray-300">{t('multisigCreate:info.secureKeys.text')}</p>
              </div>

              {/* Geheimschlüssel auf dieser Seite */}
              <div>
                <h4 className="font-bold mb-2">{t('multisigCreate:info.keysOnPage.title')}</h4>
                <p className="whitespace-pre-line text-gray-700 dark:text-gray-300">{t('multisigCreate:info.keysOnPage.text')}</p>
              </div>

              {/* Multisig */}
              <div>
                <h4 className="font-bold mb-2">{t('multisigCreate:info.multisigSection.title')}</h4>
                <p className="whitespace-pre-line text-gray-700 dark:text-gray-300">{t('multisigCreate:info.multisigSection.text')}</p>
              </div>
            </div>

            <div className="text-right mt-6">
              <button onClick={()=>{ setShowInfo2(false); }} className="px-4 py-2 rounded-sm bg-blue-600 text-white hover:bg-blue-700">
                {t('common:close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <MultiSigHelpDialog isOpen={isHelpOpen} onClose={()=>setIsHelpOpen(false)} />
    </div>
  );
}
