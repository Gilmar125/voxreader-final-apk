import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, Square, Upload, FileText, Settings, Volume2, RotateCcw, ChevronRight, ChevronLeft, Loader2 
} from 'lucide-react';

// Función auxiliar para cargar scripts externos (PDF.js, Mammoth, Tesseract)
const loadScript = (src, id) => {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.id = id;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
};

export default function App() {
  // --- ESTADOS ---
  const [text, setText] = useState('');
  const [chunks, setChunks] = useState([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  
  // Configuración de Voz
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);

  // Refs
  const synth = useRef(window.speechSynthesis);
  const utteranceRef = useRef(null);

  // --- INICIALIZACIÓN ---
  useEffect(() => {
    const initLibs = async () => {
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdf-js');
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js', 'mammoth-js');
        await loadScript('https://unpkg.com/tesseract.js@v4.1.1/dist/tesseract.min.js', 'tesseract-js');
      } catch (e) {
        console.error("Error cargando librerías:", e);
      }
    };
    initLibs();

    const loadVoices = () => {
      const availableVoices = synth.current.getVoices();
      setVoices(availableVoices);
      const spanishVoice = availableVoices.find(v => v.lang.includes('es'));
      if (spanishVoice) setSelectedVoice(spanishVoice);
      else if (availableVoices.length > 0) setSelectedVoice(availableVoices[0]);
    };

    loadVoices();
    if (synth.current.onvoiceschanged !== undefined) {
      synth.current.onvoiceschanged = loadVoices;
    }

    return () => {
      synth.current.cancel();
    };
  }, []);

  // --- PROCESAMIENTO DE TEXTO ---
  useEffect(() => {
    if (!text) {
      setChunks([]);
      return;
    }
    // Dividir por signos de puntuación o saltos de línea
    const splitText = text.match(/[^.?!]+[.?!]+|[^.?!]+$/g) || [text];
    const cleanChunks = splitText.map(t => t.trim()).filter(t => t.length > 0);
    setChunks(cleanChunks);
    setCurrentChunkIndex(0);
    setIsPlaying(false);
    setIsPaused(false);
    synth.current.cancel();
  }, [text]);

  // --- REPRODUCCIÓN ---
  const speakChunk = useCallback((index) => {
    if (index >= chunks.length || index < 0) {
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }

    synth.current.cancel();

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.voice = selectedVoice;
    utterance.rate = rate;
    utterance.pitch = pitch;

    utterance.onend = () => {
      if (!isPaused) {
        setCurrentChunkIndex(prev => {
          const next = prev + 1;
          if (next < chunks.length) {
            speakChunk(next);
            return next;
          } else {
            setIsPlaying(false);
            return 0;
          }
        });
      }
    };

    utterance.onerror = (e) => {
      console.error("Error TTS:", e);
      setIsPlaying(false);
    };

    utteranceRef.current = utterance;
    synth.current.speak(utterance);
  }, [chunks, selectedVoice, rate, pitch, isPaused]);

  const handlePlay = () => {
    if (isPaused) {
      synth.current.resume();
      setIsPaused(false);
      setIsPlaying(true);
    } else {
      setIsPlaying(true);
      speakChunk(currentChunkIndex);
    }
  };

  const handlePause = () => {
    synth.current.pause();
    setIsPaused(true);
    setIsPlaying(false);
  };

  const handleStop = () => {
    synth.current.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentChunkIndex(0);
  };

  const handleSkip = (direction) => {
    const newIndex = direction === 'next' 
      ? Math.min(chunks.length - 1, currentChunkIndex + 1)
      : Math.max(0, currentChunkIndex - 1);
    
    setCurrentChunkIndex(newIndex);
    if (isPlaying) {
      speakChunk(newIndex);
    }
  };

  // --- CARGA DE ARCHIVOS ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingMessage(`Procesando ${file.name}...`);
    handleStop();

    try {
      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'txt') {
        const reader = new FileReader();
        reader.onload = (e) => setText(e.target.result);
        reader.readAsText(file);
      } 
      else if (ext === 'docx') {
        if (!window.mammoth) throw new Error("Mammoth JS cargando...");
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        setText(result.value);
      } 
      else if (ext === 'pdf') {
        if (!window.pdfjsLib) throw new Error("PDF JS cargando...");
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          setLoadingMessage(`Leyendo pág ${i}/${pdf.numPages}...`);
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fullText += textContent.items.map(item => item.str).join(' ') + '\n\n';
        }
        setText(fullText);
      }
      else if (['jpg', 'jpeg', 'png'].includes(ext)) {
         if (!window.Tesseract) throw new Error("Tesseract OCR cargando...");
         setLoadingMessage("OCR Analizando imagen...");
         const result = await window.Tesseract.recognize(file, 'spa');
         setText(result.data.text);
      }
      else {
        alert("Formato no soportado. Usa TXT, PDF, DOCX o JPG.");
      }
    } catch (error) {
      console.error(error);
      alert("Error: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-32">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Volume2 className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-indigo-700">VoxReader</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Controles y Carga */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Input Archivo */}
            <div className="relative">
              <input type="file" id="file" className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx,.jpg,.png" />
              <label htmlFor="file" className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-indigo-50 hover:border-indigo-400 transition-all">
                {isLoading ? (
                  <div className="flex flex-col items-center animate-pulse text-indigo-600">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-xs mt-1">{loadingMessage}</span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-slate-400 mb-1" />
                    <span className="text-sm font-medium text-slate-600">Subir Archivo</span>
                  </>
                )}
              </label>
            </div>

            {/* Configuración */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-sm space-y-2">
              <select 
                className="w-full p-2 rounded border border-slate-300"
                value={selectedVoice?.name || ''}
                onChange={(e) => setSelectedVoice(voices.find(v => v.name === e.target.value))}
              >
                {voices.map(v => <option key={v.name} value={v.name}>{v.name.slice(0,30)}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">VEL: {rate}x</span>
                <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={e => setRate(parseFloat(e.target.value))} className="flex-1 accent-indigo-600"/>
              </div>
            </div>
          </div>

          {/* Área Texto */}
          <div className="relative">
            <textarea
              className="w-full h-40 p-4 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-slate-700 text-lg"
              placeholder="Escribe o pega texto aquí..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            ></textarea>
            {text && (
              <button onClick={() => {setText(''); handleStop();}} className="absolute top-2 right-2 p-1 bg-white border rounded shadow-sm hover:text-red-500">
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Vista Lectura */}
        {text && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-bold text-slate-400 mb-2 flex items-center gap-2"><FileText className="w-4 h-4"/> VISTA DE LECTURA</h3>
            <div className="h-64 overflow-y-auto pr-2 text-lg leading-relaxed text-slate-600">
              {chunks.map((chunk, index) => (
                <span 
                  key={index}
                  onClick={() => { handleStop(); setCurrentChunkIndex(index); setTimeout(() => speakChunk(index), 100); setIsPlaying(true); }}
                  className={`cursor-pointer px-1 rounded hover:bg-slate-100 transition-colors ${index === currentChunkIndex && (isPlaying || isPaused) ? 'bg-yellow-300 text-black font-medium shadow-sm' : ''}`}
                >
                  {chunk}{' '}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Reproductor Flotante */}
      {text && (
        <div className="fixed bottom-4 left-4 right-4 max-w-4xl mx-auto z-50">
          <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between gap-4 border border-slate-700">
            <div className="flex items-center gap-2">
              <button onClick={() => handleSkip('prev')} className="p-2 hover:bg-slate-700 rounded-full"><ChevronLeft className="w-6 h-6" /></button>
              <button 
                onClick={isPlaying ? handlePause : handlePlay}
                className={`w-12 h-12 flex items-center justify-center rounded-full shadow-lg ${isPlaying ? 'bg-amber-500' : 'bg-indigo-500'}`}
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-current"/> : <Play className="w-6 h-6 fill-current ml-1"/>}
              </button>
              <button onClick={handleStop} className="p-2 hover:bg-slate-700 rounded-full"><Square className="w-5 h-5 fill-current" /></button>
              <button onClick={() => handleSkip('next')} className="p-2 hover:bg-slate-700 rounded-full"><ChevronRight className="w-6 h-6" /></button>
            </div>
            <div className="flex-1 hidden sm:block">
              <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${((currentChunkIndex + 1) / Math.max(chunks.length, 1)) * 100}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}