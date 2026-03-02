import { useEffect, useRef, useState } from 'react'
import Tesseract from 'tesseract.js'
import './App.css'

type Denomination = 'Bs10' | 'Bs20' | 'Bs50'

type ValidationResult = {
  denomination: Denomination | null
  inRange: boolean
}

const INVALID_RANGES: Record<Denomination, Array<[number, number]>> = {
  Bs50: [
    [67250001, 67700000],
    [69050001, 69500000],
    [69500001, 69950000],
    [69950001, 70400000],
    [70400001, 70850000],
    [70850001, 71300000],
    [76310012, 85139995],
    [86400001, 86850000],
    [90900001, 91350000],
    [91800001, 92250000],
  ],
  Bs20: [
    [87280145, 91646549],
    [96650001, 97100000],
    [99800001, 100250000],
    [100250001, 100700000],
    [109250001, 109700000],
    [110600001, 111050000],
    [111050001, 111500000],
    [111950001, 112400000],
    [112400001, 112850000],
    [112850001, 113300000],
    [114200001, 114650000],
    [114650001, 115100000],
    [115100001, 115550000],
    [118700001, 119150000],
    [119150001, 119600000],
    [120500001, 120950000],
  ],
  Bs10: [
    [77100001, 77550000],
    [78000001, 78450000],
    [78900001, 96350000],
    [96350001, 96800000],
    [96800001, 97250000],
    [98150001, 98600000],
    [104900001, 105350000],
    [105350001, 105800000],
    [106700001, 107150000],
    [107600001, 108050000],
    [108050001, 108500000],
    [109400001, 109850000],
  ],
}

function extractSerialCandidates(text: string): string[] {
  const broadMatches = text.match(/\d[\d\s.,-]{6,14}\d/g) ?? []
  const directMatches = text.match(/\d{8,9}/g) ?? []
  const cleaned = [...broadMatches, ...directMatches]
    .map((value) => value.replace(/\D/g, ''))
    .filter((value) => value.length >= 8 && value.length <= 9)

  return Array.from(new Set(cleaned)).sort((a, b) => b.length - a.length)
}

function validateSerialInRanges(serialNumber: number): ValidationResult {
  const denominations = Object.keys(INVALID_RANGES) as Denomination[]

  for (const denomination of denominations) {
    for (const [from, to] of INVALID_RANGES[denomination]) {
      if (serialNumber >= from && serialNumber <= to) {
        return { denomination, inRange: true }
      }
    }
  }

  return { denomination: null, inRange: false }
}

function detectSerieB(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  const compact = normalized.replace(/\s/g, '')

  return (
    normalized.includes('SERIE B') ||
    compact.includes('SERIEB') ||
    /B\d{8,9}/.test(compact) ||
    /\d{8,9}B/.test(compact)
  )
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraReady, setCameraReady] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const [serialDetected, setSerialDetected] = useState('')
  const [isSerieB, setIsSerieB] = useState(false)
  const [inRange, setInRange] = useState(false)
  const [denomination, setDenomination] = useState<Denomination | null>(null)

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraReady(false)
  }

  const startCamera = async () => {
    setError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      setCameraReady(true)
    } catch {
      setError('No se pudo acceder a la cámara. Verifica permisos del navegador.')
    }
  }

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current || isAnalyzing) {
      return
    }

    if (!videoRef.current.videoWidth || !videoRef.current.videoHeight) {
      setError('La cámara aún no está lista. Intenta nuevamente en unos segundos.')
      return
    }

    setError('')
    setIsAnalyzing(true)
    setProgress(0)

    const canvas = canvasRef.current
    const video = videoRef.current
    const context = canvas.getContext('2d')

    if (!context) {
      setError('No se pudo preparar la captura de imagen.')
      setIsAnalyzing(false)
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    try {
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const result = await Tesseract.recognize(imageDataUrl, 'eng', {
        logger: (message) => {
          if (
            message.status === 'recognizing text' &&
            typeof message.progress === 'number'
          ) {
            setProgress(Math.round(message.progress * 100))
          }
        },
      })

      const text = result.data.text ?? ''
      const candidates = extractSerialCandidates(text)

      if (!candidates.length) {
        setSerialDetected('')
        setDenomination(null)
        setInRange(false)
        setIsSerieB(detectSerieB(text))
        setError('No se detectó un número de serie claro. Acerca más la cámara al serial.')
        return
      }

      let selectedSerial = candidates[0]
      let selectedValidation = validateSerialInRanges(Number(selectedSerial))

      for (const candidate of candidates) {
        const numericValue = Number(candidate)
        const validation = validateSerialInRanges(numericValue)

        if (validation.inRange) {
          selectedSerial = candidate
          selectedValidation = validation
          break
        }
      }

      setSerialDetected(selectedSerial)
      setDenomination(selectedValidation.denomination)
      setInRange(selectedValidation.inRange)
      setIsSerieB(detectSerieB(text))
    } catch {
      setError('Falló el OCR. Intenta una foto más estable y con buena iluminación.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  const isInvalidBill = isSerieB && inRange

  return (
    <main className="app">
      <h1>Validador de Billetes Serie B</h1>

      <section className="camera-panel">
        <video ref={videoRef} className="camera" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="hidden-canvas" />

        <div className="actions">
          {!cameraReady ? (
            <button onClick={startCamera}>Iniciar cámara</button>
          ) : (
            <>
              <button onClick={captureAndAnalyze} disabled={isAnalyzing}>
                {isAnalyzing ? `Analizando... ${progress}%` : 'Tomar foto y validar'}
              </button>
              <button onClick={stopCamera} className="secondary">
                Detener cámara
              </button>
            </>
          )}
        </div>

        {error && <p className="error">{error}</p>}
      </section>

      <section className="result-panel">
        <h2>Resultado</h2>
        <p>
          <strong>Número detectado:</strong> {serialDetected || 'No detectado'}
        </p>
        <p>
          <strong>Serie B detectada:</strong> {isSerieB ? 'Sí' : 'No'}
        </p>
        <p>
          <strong>En rango publicado:</strong> {inRange ? 'Sí' : 'No'}
        </p>
        <p>
          <strong>Denominación en rango:</strong> {denomination ?? 'No coincide'}
        </p>

        <p className={isInvalidBill ? 'status-bad' : 'status-ok'}>
          {isInvalidBill
            ? 'Billete Serie B en rango sin valor legal.'
            : 'No cumple simultáneamente Serie B + rango publicado.'}
        </p>
      </section>
    </main>
  )
}

export default App
