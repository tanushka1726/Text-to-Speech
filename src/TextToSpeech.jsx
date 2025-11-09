import React, { useEffect, useState, useRef } from 'react';

// Text-to-Speech React single-file component
// - Uses the Web Speech API (speechSynthesis) available in modern browsers
// - Splits input into script runs (Devanagari vs Latin) and speaks each run with an appropriate language
// - Lets user choose voice, rate, pitch, and whether to auto-split mixed-language text

export default function TextToSpeechApp() {
  const [text, setText] = useState('Hello, नमस्ते — this is a sample of Hindi + English mixed text.');
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [autoSplit, setAutoSplit] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('idle');
  const utteranceQueueRef = useRef([]);
  const currentUtteranceRef = useRef(null);

  // Utility: detect if a character belongs to Devanagari block
  function isDevanagariChar(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (code >= 0x0900 && code <= 0x097F) || (code >= 0xA8E0 && code <= 0xA8FF);
  }

  // Split text into contiguous runs of Devanagari vs non-Devanagari
  function splitByScriptRuns(input) {
    if (!input) return [];
    const runs = [];
    let currentRun = '';
    let currentIsDeva = isDevanagariChar(input[0]);

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      const chIsDeva = isDevanagariChar(ch);
      if (ch === '\n') {
        // treat newline as separator but keep it
        currentRun += ch;
        continue;
      }
      if (ch === ' ' || ch === '\t') {
        // keep spaces with current run
        currentRun += ch;
        continue;
      }
      if (chIsDeva === currentIsDeva) {
        currentRun += ch;
      } else {
        // commit previous run
        runs.push({ text: currentRun, isDevanagari: currentIsDeva });
        currentRun = ch;
        currentIsDeva = chIsDeva;
      }
    }
    if (currentRun.length) runs.push({ text: currentRun, isDevanagari: currentIsDeva });

    // Merge very small runs into neighbors to reduce choppiness (e.g., punctuation)
    const merged = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (r.text.trim() === '' && merged.length) {
        merged[merged.length - 1].text += r.text;
      } else if (r.text.length < 3 && merged.length) {
        // tiny run (like punctuation) — append to previous run
        merged[merged.length - 1].text += r.text;
      } else {
        merged.push({ ...r });
      }
    }

    return merged.filter(r => r.text.trim().length > 0);
  }

  useEffect(() => {
    function loadVoices() {
      const v = window.speechSynthesis.getVoices() || [];
      // Sort voices: prefer en/hi first so UI shows them near top
      v.sort((a, b) => (a.lang > b.lang ? 1 : -1));
      setVoices(v);
      if (!selectedVoiceURI && v.length) setSelectedVoiceURI(v[0].voiceURI);
    }

    loadVoices();
    // Firefox/Chrome may fire onvoiceschanged later
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Create a SpeechSynthesisUtterance ready with common props
  function createUtterance(textSegment, lang, voice) {
    const u = new SpeechSynthesisUtterance(textSegment);
    if (lang) u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    u.onstart = () => {
      setStatus('speaking');
      currentUtteranceRef.current = u;
    };
    u.onend = () => {
      currentUtteranceRef.current = null;
    };
    u.onerror = (e) => {
      console.error('SpeechSynthesis error', e);
      setStatus('error');
      currentUtteranceRef.current = null;
    };
    return u;
  }

  // Attempt to choose a voice for given language code from available voices
  function chooseVoiceForLang(langCode) {
    if (!voices || voices.length === 0) return null;
    // Prefer an exact lang match and the selectedVoiceURI if it matches
    const exact = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
    if (exact) return exact;
    // else try match selectedVoiceURI
    const sel = voices.find(v => v.voiceURI === selectedVoiceURI);
    if (sel) return sel;
    // fallback to first voice
    return voices[0];
  }

  // Build utterance queue and speak
  function speakText() {
    if (!('speechSynthesis' in window)) {
      alert('Your browser does not support the Web Speech API (speechSynthesis). Try Chrome, Edge or Safari.');
      return;
    }

    // Cancel any existing speech
    window.speechSynthesis.cancel();
    utteranceQueueRef.current = [];

    if (!text || text.trim() === '') return;

    if (autoSplit) {
      const runs = splitByScriptRuns(text);
      for (const run of runs) {
        const lang = run.isDevanagari ? 'hi-IN' : 'en-US';
        const voice = chooseVoiceForLang(lang);
        const u = createUtterance(run.text, lang, voice);
        utteranceQueueRef.current.push(u);
      }
    } else {
      // single utterance — use selected voice and no per-run lang
      const selVoice = voices.find(v => v.voiceURI === selectedVoiceURI) || null;
      const u = createUtterance(text, '', selVoice);
      utteranceQueueRef.current.push(u);
    }

    // Chain and play
    if (utteranceQueueRef.current.length) {
      setIsSpeaking(true);
      setStatus('queued');
      const playNext = () => {
        if (!utteranceQueueRef.current.length) {
          setIsSpeaking(false);
          setStatus('idle');
          return;
        }
        const next = utteranceQueueRef.current.shift();
        next.onend = () => {
          // small gap before next chunk to avoid merging in some voices
          setTimeout(playNext, 80);
        };
        next.onerror = (e) => {
          console.error('Utterance error', e);
          playNext();
        };
        window.speechSynthesis.speak(next);
      };
      playNext();
    }
  }

  function pauseSpeech() {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setStatus('paused');
    }
  }
  function resumeSpeech() {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setStatus('speaking');
    }
  }
  function stopSpeech() {
    window.speechSynthesis.cancel();
    utteranceQueueRef.current = [];
    setIsSpeaking(false);
    setStatus('idle');
  }

  function handleVoiceChange(e) {
    setSelectedVoiceURI(e.target.value);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="max-w-3xl w-full bg-white rounded-2xl shadow-lg p-6">
        <h1 className="text-2xl font-semibold mb-2">Text → Speech (Multilingual friendly)</h1>
        <p className="text-sm text-gray-600 mb-4">
          Type a sentence (can mix Hindi in Devanagari and English). The app will detect Devanagari script and speak those runs with a Hindi voice when available.
        </p>

        <label className="block mb-2 text-sm font-medium">Enter text</label>
        <textarea
          className="w-full border rounded-md p-3 h-36 resize-vertical focus:outline-none focus:ring"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Text to speak"
        />

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Voice</label>
            <select value={selectedVoiceURI} onChange={handleVoiceChange} className="w-full border rounded p-2">
              {voices.length === 0 && <option>Loading voices...</option>}
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang} {v.default ? '(default)' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Tip: pick a voice that best matches the language in your text.</p>
          </div>

          <div>
            <label className="block text-sm font-medium">Rate: {rate.toFixed(2)}</label>
            <input type="range" min="0.5" max="2" step="0.05" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="w-full" />
            <label className="block text-sm font-medium mt-2">Pitch: {pitch.toFixed(2)}</label>
            <input type="range" min="0.5" max="2" step="0.05" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} className="w-full" />
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoSplit} onChange={(e) => setAutoSplit(e.target.checked)} />
            <span className="text-sm">Auto-split mixed scripts (Hindi/English)</span>
          </label>

          <button onClick={speakText} className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm hover:brightness-90">
            Speak
          </button>

          <button onClick={pauseSpeech} className="bg-yellow-500 text-white px-3 py-2 rounded-lg shadow-sm hover:brightness-90">
            Pause
          </button>
          <button onClick={resumeSpeech} className="bg-green-600 text-white px-3 py-2 rounded-lg shadow-sm hover:brightness-90">
            Resume
          </button>
          <button onClick={stopSpeech} className="bg-red-600 text-white px-3 py-2 rounded-lg shadow-sm hover:brightness-90">
            Stop
          </button>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          <strong>Status:</strong> {status}
        </div>

        <div className="mt-6 bg-gray-50 p-4 rounded-md text-sm">
          <strong>How it works</strong>
          <ol className="list-decimal list-inside mt-2">
            <li>When Auto-split is on, the app breaks your text into runs of Devanagari (हिंदी) and non-Devanagari (English / Latin) characters.</li>
            <li>Each run is spoken with a language code — Devanagari runs use <code>hi-IN</code>, others use <code>en-US</code> where possible.</li>
            <li>If a voice that matches the language is available it will be preferred; otherwise the selected/default voice is used.</li>
          </ol>

          <p className="mt-2 text-xs text-gray-500">Note: Transliteration (Hindi written in Latin letters) cannot be detected automatically — treat it as English text. You can uncheck Auto-split to force a single voice for the whole text.</p>
        </div>

      </div>
    </div>
  );
}
