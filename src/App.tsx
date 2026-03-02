import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Tesseract from 'tesseract.js'
import './App.css'

type Denomination = 'Bs10' | 'Bs20' | 'Bs50'
type PrecisionMode = 'fast' | 'high'

type ValidationResult = {
  denomination: Denomination | null
  inRange: boolean
}

const OCR_DIGIT_MAP: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  B: '8',
}

const PRECISION_MODE_STORAGE_KEY = 'serieB.precisionMode'

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

function normalizeOcrToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[OQDILZSB]/g, (char) => OCR_DIGIT_MAP[char] ?? char)
    .replace(/\D/g, '')
}

function extractSerialCandidates(text: string): string[] {
  const normalizedText = text.toUpperCase()
  const broadMatches = normalizedText.match(/[0-9OQDILZSB][0-9OQDILZSB\s.,-]{6,16}[0-9OQDILZSB]/g) ?? []
  const directMatches = normalizedText.match(/[0-9OQDILZSB]{8,10}/g) ?? []
  const cleaned = [...broadMatches, ...directMatches]
    .map(normalizeOcrToken)
    .filter((value) => value.length >= 8 && value.length <= 9)

  return Array.from(new Set(cleaned)).sort((a, b) => b.length - a.length)
}

async function loadImageFromDataUrl(imageDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo cargar la imagen'))
    image.src = imageDataUrl
  })
}

function createContrastVariant(image: HTMLImageElement, threshold: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.width * 2
  canvas.height = image.height * 2
  const context = canvas.getContext('2d')

  if (!context) {
    return image.src
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const gray = 0.299 * red + 0.587 * green + 0.114 * blue
    const value = gray > threshold ? 255 : 0

    pixels[index] = value
    pixels[index + 1] = value
    pixels[index + 2] = value
  }

  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

async function createOcrVariants(
  imageDataUrl: string,
  mode: PrecisionMode,
): Promise<string[]> {
  const image = await loadImageFromDataUrl(imageDataUrl)
  const variants =
    mode === 'fast'
      ? [imageDataUrl, createContrastVariant(image, 160)]
      : [imageDataUrl, createContrastVariant(image, 145), createContrastVariant(image, 170)]

  return Array.from(new Set(variants))
}

async function createSerialBandSources(
  imageDataUrl: string,
  mode: PrecisionMode,
): Promise<string[]> {
  const image = await loadImageFromDataUrl(imageDataUrl)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    return [imageDataUrl]
  }

  const xPct = 0.08
  const wPct = 0.84
  const hPct = 0.2
  const centerYPcts = mode === 'fast' ? [0.48, 0.54] : [0.42, 0.48, 0.54, 0.6]
  const variants: string[] = []

  for (const centerYPct of centerYPcts) {
    const startYPct = Math.max(0, Math.min(1 - hPct, centerYPct - hPct / 2))

    const sx = Math.floor(image.width * xPct)
    const sy = Math.floor(image.height * startYPct)
    const sw = Math.floor(image.width * wPct)
    const sh = Math.floor(image.height * hPct)

    canvas.width = sw
    canvas.height = sh
    context.clearRect(0, 0, sw, sh)
    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
    variants.push(canvas.toDataURL('image/jpeg', 0.92))
  }

  return Array.from(new Set(variants))
}

function selectBestSerial(textBlocks: string[]): string {
  const scoreMap = new Map<string, number>()

  for (const text of textBlocks) {
    const candidates = extractSerialCandidates(text)

    candidates.forEach((candidate, index) => {
      const { inRange } = validateSerialInRanges(Number(candidate))
      const rankBoost = index === 0 ? 2 : 1
      const rangeBoost = inRange ? 4 : 0
      const lengthBoost = candidate.length === 9 ? 0.4 : 0
      const current = scoreMap.get(candidate) ?? 0

      scoreMap.set(candidate, current + rankBoost + rangeBoost + lengthBoost)
    })
  }

  return [...scoreMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraReady, setCameraReady] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const [serialDetected, setSerialDetected] = useState('')
  const [isSerieB, setIsSerieB] = useState(false)
  const [inRange, setInRange] = useState(false)
  const [denomination, setDenomination] = useState<Denomination | null>(null)
  const [precisionMode, setPrecisionMode] = useState<PrecisionMode>(() => {
    try {
      const savedMode = localStorage.getItem(PRECISION_MODE_STORAGE_KEY)
      return savedMode === 'fast' || savedMode === 'high' ? savedMode : 'high'
    } catch {
      return 'high'
    }
  })

  const guideRegion = {
    xPct: 0.12,
    yPct: 0.42,
    wPct: 0.76,
    hPct: 0.18,
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraReady(false)
  }

  const applyDetectionResult = (text: string, preferredSerial?: string) => {
    const extractedCandidates = extractSerialCandidates(text)
    const candidates = preferredSerial
      ? [preferredSerial, ...extractedCandidates.filter((value) => value !== preferredSerial)]
      : extractedCandidates

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
  }

  const analyzeImageByOcr = async (
    primaryImageDataUrls: string[] | string,
    mode: PrecisionMode,
    fallbackImageDataUrls?: string[] | string,
  ) => {
    const textBlocks: string[] = []
    const primarySourcesRaw = Array.isArray(primaryImageDataUrls)
      ? primaryImageDataUrls
      : [primaryImageDataUrls]
    const primarySources =
      mode === 'fast' ? primarySourcesRaw.slice(0, 2) : primarySourcesRaw

    for (let sourceIndex = 0; sourceIndex < primarySources.length; sourceIndex += 1) {
      const source = primarySources[sourceIndex]
      const sourceVariants = await createOcrVariants(source, mode)

      for (let variantIndex = 0; variantIndex < sourceVariants.length; variantIndex += 1) {
        const variant = sourceVariants[variantIndex]
        const result = await Tesseract.recognize(variant, 'eng', {
          logger: (message) => {
            if (
              sourceIndex === 0 &&
              variantIndex === 0 &&
              message.status === 'recognizing text' &&
              typeof message.progress === 'number'
            ) {
              setProgress(Math.round(message.progress * 100))
            }
          },
        })

        textBlocks.push(result.data.text ?? '')
      }
    }

    let selectedSerial = selectBestSerial(textBlocks)

    if (!selectedSerial && fallbackImageDataUrls) {
      const fallbackSourcesRaw = Array.isArray(fallbackImageDataUrls)
        ? fallbackImageDataUrls
        : [fallbackImageDataUrls]
      const fallbackSources =
        mode === 'fast' ? fallbackSourcesRaw.slice(0, 1) : fallbackSourcesRaw

      for (const fallbackSource of fallbackSources) {
        const fallbackVariants = await createOcrVariants(fallbackSource, mode)

        for (const variant of fallbackVariants) {
          const fallbackResult = await Tesseract.recognize(variant, 'eng')
          textBlocks.push(fallbackResult.data.text ?? '')
        }
      }

      selectedSerial = selectBestSerial(textBlocks)
    }

    applyDetectionResult(textBlocks.join('\n'), selectedSerial)
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

    const sourceWidth = video.videoWidth
    const sourceHeight = video.videoHeight
    const sx = Math.floor(sourceWidth * guideRegion.xPct)
    const sy = Math.floor(sourceHeight * guideRegion.yPct)
    const sw = Math.floor(sourceWidth * guideRegion.wPct)
    const sh = Math.floor(sourceHeight * guideRegion.hPct)

    canvas.width = sw
    canvas.height = sh
    context.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)

    try {
      const regionImageDataUrl = canvas.toDataURL('image/jpeg', 0.92)

      canvas.width = sourceWidth
      canvas.height = sourceHeight
      context.drawImage(video, 0, 0, sourceWidth, sourceHeight)
      const fullImageDataUrl = canvas.toDataURL('image/jpeg', 0.9)

      await analyzeImageByOcr([regionImageDataUrl], precisionMode, [fullImageDataUrl])
    } catch {
      setError('Falló el OCR. Intenta una foto más estable y con buena iluminación.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const openGalleryPicker = () => {
    if (isAnalyzing) {
      return
    }
    fileInputRef.current?.click()
  }

  const handleGallerySelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || isAnalyzing) {
      return
    }

    setError('')
    setIsAnalyzing(true)
    setProgress(0)

    try {
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
        reader.readAsDataURL(file)
      })

      const serialBandSources = await createSerialBandSources(imageDataUrl, precisionMode)
      await analyzeImageByOcr(serialBandSources, precisionMode, [imageDataUrl])
    } catch {
      setError('No se pudo analizar la imagen seleccionada.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PRECISION_MODE_STORAGE_KEY, precisionMode)
    } catch {
      return
    }
  }, [precisionMode])

  const isInvalidBill = isSerieB && inRange

  return (
    <main className="app">
      <h1>Validador de Billetes Serie B</h1>

      <section className="camera-panel">
        <div className="camera-frame">
          <video ref={videoRef} className="camera" autoPlay playsInline muted />
          <div className="serial-guide" aria-hidden="true">
            <span>Enfoca aquí el número de serie</span>
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden-canvas" />

        <div className="actions">
          <div className="precision-controls">
            <span>Modo OCR:</span>
            <button
              className={precisionMode === 'fast' ? 'toggle active' : 'toggle secondary'}
              onClick={() => setPrecisionMode('fast')}
              disabled={isAnalyzing}
              type="button"
            >
              Rápido
            </button>
            <button
              className={precisionMode === 'high' ? 'toggle active' : 'toggle secondary'}
              onClick={() => setPrecisionMode('high')}
              disabled={isAnalyzing}
              type="button"
            >
              Alta precisión
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="file-input"
            onChange={handleGallerySelection}
          />

          {!cameraReady ? (
            <>
              <button onClick={startCamera}>Iniciar cámara</button>
              <button onClick={openGalleryPicker} className="secondary" disabled={isAnalyzing}>
                Usar foto de galería
              </button>
            </>
          ) : (
            <>
              <button onClick={captureAndAnalyze} disabled={isAnalyzing}>
                {isAnalyzing ? `Analizando... ${progress}%` : 'Tomar foto y validar'}
              </button>
              <button onClick={stopCamera} className="secondary">
                Detener cámara
              </button>
              <button onClick={openGalleryPicker} className="secondary" disabled={isAnalyzing}>
                Usar foto de galería
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
