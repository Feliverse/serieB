import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Tesseract from 'tesseract.js'
import './App.css'

type Denomination = 'Bs10' | 'Bs20' | 'Bs50'
type PrecisionMode = 'fast' | 'high'

type ValidationResult = {
  denomination: Denomination | null
  inRange: boolean
}

type ColorAnalysis = {
  denomination: Denomination | null
  confidence: number
}

type DenominationSignal = {
  denomination: Denomination | null
  confidence: number
}

type WorkflowState = 'idle' | 'monitoring' | 'awaiting-confirmation' | 'completed'

type CalibrationState = {
  consecutiveCorrect: Record<Denomination, number>
  bias: Record<Denomination, number>
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
const TERMS_ACCEPTED_STORAGE_KEY = 'serieB.termsAccepted'
const CAMERA_CONSENT_STORAGE_KEY = 'serieB.cameraConsent'
const ONBOARDING_DONE_STORAGE_KEY = 'serieB.onboardingDone'
const CALIBRATION_STORAGE_KEY = 'serieB.calibrationState'

const EMPTY_CALIBRATION: CalibrationState = {
  consecutiveCorrect: {
    Bs10: 0,
    Bs20: 0,
    Bs50: 0,
  },
  bias: {
    Bs10: 0,
    Bs20: 0,
    Bs50: 0,
  },
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

function extractDenominationFromText(text: string): DenominationSignal {
  const normalized = text.toUpperCase()
  const explicitWithCurrency = normalized.match(
    /(?:BS\s*|B\.?\s*S\.?\s*)(10|20|50)(?!\d)|(10|20|50)\s*(?:BS|BOLIVIANOS?)/,
  )

  if (explicitWithCurrency) {
    const value = explicitWithCurrency[1] ?? explicitWithCurrency[2]
    if (value === '10') return { denomination: 'Bs10', confidence: 1 }
    if (value === '20') return { denomination: 'Bs20', confidence: 1 }
    if (value === '50') return { denomination: 'Bs50', confidence: 1 }
  }

  if (normalized.includes('DIEZ')) {
    return { denomination: 'Bs10', confidence: 0.75 }
  }

  if (normalized.includes('VEINTE')) {
    return { denomination: 'Bs20', confidence: 0.75 }
  }

  if (normalized.includes('CINCUENTA')) {
    return { denomination: 'Bs50', confidence: 0.8 }
  }

  const isolatedNumberMatch = normalized.match(/(?<!\d)(10|20|50)(?!\d)/)

  if (!isolatedNumberMatch) {
    return { denomination: null, confidence: 0 }
  }

  const isolatedValue = isolatedNumberMatch[1]

  if (isolatedValue === '10') return { denomination: 'Bs10', confidence: 0.35 }
  if (isolatedValue === '20') return { denomination: 'Bs20', confidence: 0.35 }
  if (isolatedValue === '50') return { denomination: 'Bs50', confidence: 0.35 }

  return { denomination: null, confidence: 0 }
}

function detectUnsupportedDenominationFromText(text: string): string | null {
  const normalized = text.toUpperCase()
  const match = normalized.match(
    /(?:BS\s*|B\.?\s*S\.?\s*)(\d{2,3})(?!\d)|(\d{2,3})\s*(?:BS|BOLIVIANOS?)/,
  )

  if (!match) {
    return null
  }

  const rawValue = Number(match[1] ?? match[2])

  if ([10, 20, 50].includes(rawValue)) {
    return null
  }

  return String(rawValue)
}

function rgbToHsv(red: number, green: number, blue: number) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let hue = 0
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
  }

  hue = Math.round(hue * 60)
  if (hue < 0) hue += 360

  const saturation = max === 0 ? 0 : delta / max
  const value = max

  return { hue, saturation, value }
}

function estimateFinalDenomination(
  rangeDenomination: Denomination | null,
  textSignal: DenominationSignal,
  calibrationBias: Record<Denomination, number>,
  colorAnalysis?: ColorAnalysis,
): { denomination: Denomination | null; confidence: number } {
  const scores: Record<Denomination, number> = {
    Bs10: 0,
    Bs20: 0,
    Bs50: 0,
  }

  if (rangeDenomination) {
    scores[rangeDenomination] += 3
  }

  if (textSignal.denomination) {
    scores[textSignal.denomination] += 2.2 * Math.max(0, Math.min(1, textSignal.confidence))
  }

  if (colorAnalysis?.denomination) {
    scores[colorAnalysis.denomination] += Math.max(0, Math.min(1, colorAnalysis.confidence)) * 1.4
  }

  scores.Bs10 += calibrationBias.Bs10
  scores.Bs20 += calibrationBias.Bs20
  scores.Bs50 += calibrationBias.Bs50

  const sorted = (Object.entries(scores) as Array<[Denomination, number]>).sort(
    (a, b) => b[1] - a[1],
  )

  const [bestDenomination, bestScore] = sorted[0]
  const secondBestScore = sorted[1]?.[1] ?? 0

  if (bestScore <= 0.35) {
    return { denomination: null, confidence: 0 }
  }

  const confidence = Math.max(0.2, Math.min(1, (bestScore - secondBestScore + bestScore / 4) / 3.5))
  return { denomination: bestDenomination, confidence }
}

function isSerialInDenominationRange(serialNumber: number, denomination: Denomination): boolean {
  return INVALID_RANGES[denomination].some(
    ([from, to]) => serialNumber >= from && serialNumber <= to,
  )
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

async function detectDenominationByColor(imageDataUrl: string): Promise<ColorAnalysis> {
  const image = await loadImageFromDataUrl(imageDataUrl)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    return { denomination: null, confidence: 0 }
  }

  const targetWidth = 220
  const ratio = image.height / image.width
  canvas.width = targetWidth
  canvas.height = Math.max(120, Math.round(targetWidth * ratio))
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data

  const bucket: Record<Denomination, number> = {
    Bs10: 0,
    Bs20: 0,
    Bs50: 0,
  }

  let totalWeight = 0

  for (let index = 0; index < pixels.length; index += 12) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const { hue, saturation, value } = rgbToHsv(red, green, blue)

    if (saturation < 0.12 || value < 0.12 || value > 0.95) {
      continue
    }

    const weight = saturation * value

    const isOrange = hue >= 14 && hue <= 46
    const isGreen = hue >= 74 && hue <= 150
    const isPurple = hue >= 260 || hue <= 338

    if (isOrange) bucket.Bs10 += weight
    if (isGreen) bucket.Bs20 += weight
    if (isPurple) bucket.Bs50 += weight

    totalWeight += weight
  }

  if (totalWeight <= 0) {
    return { denomination: null, confidence: 0 }
  }

  const normalizedScores: Record<Denomination, number> = {
    Bs10: bucket.Bs10 / totalWeight,
    Bs20: bucket.Bs20 / totalWeight,
    Bs50: bucket.Bs50 / totalWeight,
  }

  const sorted = (Object.entries(normalizedScores) as Array<[Denomination, number]>).sort(
    (a, b) => b[1] - a[1],
  )

  const best = sorted[0]
  const second = sorted[1]
  const dominance = best[1] - (second?.[1] ?? 0)
  const confidence = Math.max(0, Math.min(1, best[1] * 2.1 + dominance * 1.7))

  if (confidence < 0.25) {
    return { denomination: null, confidence }
  }

  return {
    denomination: best[0],
    confidence,
  }
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
  const [denominationByText, setDenominationByText] = useState<Denomination | null>(null)
  const [denominationByColor, setDenominationByColor] = useState<Denomination | null>(null)
  const [colorConfidence, setColorConfidence] = useState(0)
  const [finalDenomination, setFinalDenomination] = useState<Denomination | null>(null)
  const [finalConfidence, setFinalConfidence] = useState(0)
  const [unsupportedDenomination, setUnsupportedDenomination] = useState<string | null>(null)
  const [workflowState, setWorkflowState] = useState<WorkflowState>('idle')
  const [processMessage, setProcessMessage] = useState('')
  const [confirmedDenomination, setConfirmedDenomination] = useState<Denomination | null>(null)
  const [isLegalBill, setIsLegalBill] = useState<boolean | null>(null)
  const [manualCorrection, setManualCorrection] = useState<Denomination>('Bs10')
  const [calibration, setCalibration] = useState<CalibrationState>(() => {
    try {
      const saved = localStorage.getItem(CALIBRATION_STORAGE_KEY)
      if (!saved) {
        return EMPTY_CALIBRATION
      }

      const parsed = JSON.parse(saved) as CalibrationState
      return {
        consecutiveCorrect: {
          Bs10: parsed.consecutiveCorrect?.Bs10 ?? 0,
          Bs20: parsed.consecutiveCorrect?.Bs20 ?? 0,
          Bs50: parsed.consecutiveCorrect?.Bs50 ?? 0,
        },
        bias: {
          Bs10: parsed.bias?.Bs10 ?? 0,
          Bs20: parsed.bias?.Bs20 ?? 0,
          Bs50: parsed.bias?.Bs50 ?? 0,
        },
      }
    } catch {
      return EMPTY_CALIBRATION
    }
  })
  const [precisionMode, setPrecisionMode] = useState<PrecisionMode>(() => {
    try {
      const savedMode = localStorage.getItem(PRECISION_MODE_STORAGE_KEY)
      return savedMode === 'fast' || savedMode === 'high' ? savedMode : 'high'
    } catch {
      return 'high'
    }
  })
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [hasCameraConsent, setHasCameraConsent] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CAMERA_CONSENT_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [hasEnteredApp, setHasEnteredApp] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARDING_DONE_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false)

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

  const resetResults = () => {
    setError('')
    setSerialDetected('')
    setIsSerieB(false)
    setInRange(false)
    setDenomination(null)
    setDenominationByText(null)
    setDenominationByColor(null)
    setColorConfidence(0)
    setFinalDenomination(null)
    setFinalConfidence(0)
    setUnsupportedDenomination(null)
    setProcessMessage('')
    setConfirmedDenomination(null)
    setIsLegalBill(null)
    setProgress(0)
    setWorkflowState(cameraReady ? 'idle' : 'idle')
  }

  const ensureTermsAccepted = () => {
    if (hasAcceptedTerms && hasCameraConsent) {
      return true
    }

    setError('Debes aceptar Términos y uso de cámara antes de usar el análisis.')
    return false
  }

  const applyDetectionResult = (
    text: string,
    preferredSerial?: string,
    colorAnalysis?: ColorAnalysis,
  ) => {
    const extractedCandidates = extractSerialCandidates(text)
    const candidates = preferredSerial
      ? [preferredSerial, ...extractedCandidates.filter((value) => value !== preferredSerial)]
      : extractedCandidates
    const textSignal = extractDenominationFromText(text)
    const unsupported = detectUnsupportedDenominationFromText(text)
    setUnsupportedDenomination(unsupported)
    setDenominationByText(textSignal.denomination)
    setDenominationByColor(colorAnalysis?.denomination ?? null)
    setColorConfidence(colorAnalysis?.confidence ?? 0)

    if (!candidates.length) {
      setSerialDetected('')
      setDenomination(null)
      setInRange(false)
      setIsSerieB(detectSerieB(text))
      const estimated = estimateFinalDenomination(
        null,
        textSignal,
        calibration.bias,
        colorAnalysis,
      )
      setFinalDenomination(estimated.denomination)
      setFinalConfidence(estimated.confidence)
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
    const estimated = estimateFinalDenomination(
      selectedValidation.denomination,
      textSignal,
      calibration.bias,
      colorAnalysis,
    )
    setFinalDenomination(estimated.denomination)
    setFinalConfidence(estimated.confidence)
  }

  const analyzeImageByOcr = async (
    primaryImageDataUrls: string[] | string,
    mode: PrecisionMode,
    fallbackImageDataUrls?: string[] | string,
    colorAnalysis?: ColorAnalysis,
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

    applyDetectionResult(textBlocks.join('\n'), selectedSerial, colorAnalysis)
  }

  const startCamera = async () => {
    if (!ensureTermsAccepted()) {
      return
    }

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
    if (!ensureTermsAccepted()) {
      return
    }

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
      const colorAnalysis = await detectDenominationByColor(fullImageDataUrl)

      await analyzeImageByOcr(
        [regionImageDataUrl],
        precisionMode,
        [fullImageDataUrl],
        colorAnalysis,
      )
    } catch {
      setError('Falló el OCR. Intenta una foto más estable y con buena iluminación.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const openGalleryPicker = () => {
    if (!ensureTermsAccepted()) {
      return
    }

    if (isAnalyzing) {
      return
    }
    fileInputRef.current?.click()
  }

  const handleGallerySelection = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!ensureTermsAccepted()) {
      return
    }

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
      const colorAnalysis = await detectDenominationByColor(imageDataUrl)
      await analyzeImageByOcr(serialBandSources, precisionMode, [imageDataUrl], colorAnalysis)
    } catch {
      setError('No se pudo analizar la imagen seleccionada.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const startMonitoring = () => {
    if (!cameraReady || !ensureTermsAccepted()) {
      return
    }

    setError('')
    setProcessMessage('Analizando billete automáticamente...')
    setWorkflowState('monitoring')
  }

  const stopMonitoring = () => {
    if (workflowState !== 'monitoring') {
      return
    }

    setWorkflowState('idle')
    setProcessMessage('Monitoreo detenido por el usuario.')
  }

  const completeWithDenomination = (chosenDenomination: Denomination) => {
    const serialNumber = Number(serialDetected)

    if (!serialDetected || Number.isNaN(serialNumber)) {
      setProcessMessage('No se pudo validar el número de serie para el corte confirmado.')
      setWorkflowState('completed')
      return
    }

    const serialInRangeForCut = isSerialInDenominationRange(serialNumber, chosenDenomination)
    const legal = !serialInRangeForCut

    setConfirmedDenomination(chosenDenomination)
    setIsLegalBill(legal)
    setWorkflowState('completed')
    setProcessMessage(
      legal
        ? `Billete ${chosenDenomination} Serie B legal (fuera de rangos observados).`
        : `Billete ${chosenDenomination} Serie B sin valor legal (dentro de rangos observados).`,
    )
  }

  const handleConfirmDenomination = (isCorrect: boolean) => {
    if (!finalDenomination) {
      setProcessMessage('No hay corte estimado para confirmar. Intenta otra captura.')
      setWorkflowState('completed')
      return
    }

    if (isCorrect) {
      setCalibration((previous) => {
        const nextCount = Math.min(2, previous.consecutiveCorrect[finalDenomination] + 1)
        return {
          ...previous,
          consecutiveCorrect: {
            ...previous.consecutiveCorrect,
            [finalDenomination]: nextCount,
          },
        }
      })

      completeWithDenomination(finalDenomination)
      return
    }

    const corrected = manualCorrection
    setCalibration((previous) => {
      const updatedBias = {
        ...previous.bias,
        [finalDenomination]: Math.max(-1.5, previous.bias[finalDenomination] - 0.45),
        [corrected]: Math.min(1.5, previous.bias[corrected] + 0.45),
      }

      return {
        bias: updatedBias,
        consecutiveCorrect: {
          ...previous.consecutiveCorrect,
          [corrected]: 0,
        },
      }
    })

    setFinalDenomination(corrected)
    setFinalConfidence(Math.max(0.45, finalConfidence * 0.8))
    completeWithDenomination(corrected)
  }

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  useEffect(() => {
    if (workflowState !== 'monitoring' || !cameraReady || isAnalyzing) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void captureAndAnalyze()
    }, 650)

    return () => window.clearTimeout(timeoutId)
  }, [workflowState, cameraReady, isAnalyzing, precisionMode])

  useEffect(() => {
    if (workflowState !== 'monitoring' || isAnalyzing) {
      return
    }

    if (unsupportedDenomination) {
      setProcessMessage(`Se detectó un corte no admitido (${unsupportedDenomination} Bs).`)
      setWorkflowState('completed')
      return
    }

    if (serialDetected && !isSerieB) {
      setProcessMessage('Billete detectado, pero no corresponde a Serie B.')
      setWorkflowState('completed')
      return
    }

    if (isSerieB) {
      if (!finalDenomination) {
        setProcessMessage('Serie B detectada, pero no se pudo determinar el corte con confianza.')
        setWorkflowState('completed')
        return
      }

      setManualCorrection(finalDenomination)
      setProcessMessage('Serie B detectada. Confirma el corte estimado para continuar.')
      setWorkflowState('awaiting-confirmation')
    }
  }, [
    workflowState,
    isAnalyzing,
    unsupportedDenomination,
    serialDetected,
    isSerieB,
    finalDenomination,
  ])

  useEffect(() => {
    try {
      localStorage.setItem(PRECISION_MODE_STORAGE_KEY, precisionMode)
    } catch {
      return
    }
  }, [precisionMode])

  useEffect(() => {
    try {
      localStorage.setItem(TERMS_ACCEPTED_STORAGE_KEY, String(hasAcceptedTerms))
    } catch {
      return
    }
  }, [hasAcceptedTerms])

  useEffect(() => {
    try {
      localStorage.setItem(CAMERA_CONSENT_STORAGE_KEY, String(hasCameraConsent))
    } catch {
      return
    }
  }, [hasCameraConsent])

  useEffect(() => {
    try {
      localStorage.setItem(ONBOARDING_DONE_STORAGE_KEY, String(hasEnteredApp))
    } catch {
      return
    }
  }, [hasEnteredApp])

  useEffect(() => {
    try {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration))
    } catch {
      return
    }
  }, [calibration])

  useEffect(() => {
    if (!isTermsModalOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTermsModalOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isTermsModalOpen])

  const isInvalidBill = isSerieB && inRange
  const statusText = isInvalidBill
    ? 'Billete Serie B en rango sin valor legal.'
    : 'No cumple simultáneamente Serie B + rango publicado.'
  const cameraStateText = cameraReady
    ? 'Cámara activa. Alinea el número dentro del recuadro.'
    : 'Cámara detenida. Puedes iniciar cámara o usar una foto.'
  const termsFileUrl = `${import.meta.env.BASE_URL}terms-and-conditions.md`
  const isCalibrationReady = {
    Bs10: calibration.consecutiveCorrect.Bs10 >= 2,
    Bs20: calibration.consecutiveCorrect.Bs20 >= 2,
    Bs50: calibration.consecutiveCorrect.Bs50 >= 2,
  }
  const hasAnyResult =
    Boolean(serialDetected) ||
    Boolean(denomination) ||
    Boolean(denominationByText) ||
    Boolean(denominationByColor) ||
    Boolean(finalDenomination)

  return (
    <main className="app">
      <header className="app-header">
        <h1>Validador de Billetes Serie B</h1>
        <p>
          Detecta el número de serie con OCR y verifica si corresponde a Serie B y a los
          rangos publicados.
        </p>

        <div className="terms-consent">
          <label>
            <input
              type="checkbox"
              checked={hasAcceptedTerms}
              onChange={(event) => setHasAcceptedTerms(event.target.checked)}
            />
            He leído y acepto los Términos y Condiciones.
          </label>
          <label>
            <input
              type="checkbox"
              checked={hasCameraConsent}
              onChange={(event) => setHasCameraConsent(event.target.checked)}
            />
            Acepto el uso de cámara para análisis.
          </label>
          <button type="button" className="text-button" onClick={() => setIsTermsModalOpen(true)}>
            Leer términos (modal)
          </button>
        </div>

        <div className="status-chips" aria-live="polite">
          <span className={hasAcceptedTerms ? 'chip ok' : 'chip warn'}>
            {hasAcceptedTerms ? 'Términos aceptados' : 'Pendiente aceptar términos'}
          </span>
          <span className={cameraReady ? 'chip ok' : 'chip neutral'}>
            {cameraReady ? 'Cámara activa' : 'Cámara inactiva'}
          </span>
          <span className="chip neutral">Modo OCR: {precisionMode === 'high' ? 'Alta precisión' : 'Rápido'}</span>
          <span className={isCalibrationReady.Bs10 ? 'chip ok' : 'chip warn'}>
            Calibración Bs10: {isCalibrationReady.Bs10 ? 'Lista' : `${calibration.consecutiveCorrect.Bs10}/2`}
          </span>
          <span className={isCalibrationReady.Bs20 ? 'chip ok' : 'chip warn'}>
            Calibración Bs20: {isCalibrationReady.Bs20 ? 'Lista' : `${calibration.consecutiveCorrect.Bs20}/2`}
          </span>
          <span className={isCalibrationReady.Bs50 ? 'chip ok' : 'chip warn'}>
            Calibración Bs50: {isCalibrationReady.Bs50 ? 'Lista' : `${calibration.consecutiveCorrect.Bs50}/2`}
          </span>
        </div>
      </header>

      <section className="camera-panel">
        <h2>Captura</h2>
        <p className="panel-hint">{cameraStateText}</p>

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

          <p className="mode-help">
            {precisionMode === 'high'
              ? 'Alta precisión: más análisis y mayor exactitud.'
              : 'Rápido: resultado más veloz con menos pasadas OCR.'}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="file-input"
            onChange={handleGallerySelection}
          />

          {!cameraReady ? (
            <>
              <button onClick={startCamera} disabled={!hasAcceptedTerms || !hasCameraConsent}>
                Iniciar cámara
              </button>
              <button
                onClick={openGalleryPicker}
                className="secondary"
                disabled={isAnalyzing || !hasAcceptedTerms || !hasCameraConsent}
              >
                Usar foto de galería
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startMonitoring}
                disabled={
                  isAnalyzing ||
                  !hasAcceptedTerms ||
                  !hasCameraConsent ||
                  workflowState === 'monitoring'
                }
              >
                {workflowState === 'monitoring' ? `Monitoreando... ${progress}%` : 'Iniciar monitoreo automático'}
              </button>
              <button
                onClick={stopMonitoring}
                className="secondary"
                disabled={workflowState !== 'monitoring'}
              >
                Detener monitoreo
              </button>
              <button onClick={stopCamera} className="secondary">
                Detener cámara
              </button>
              <button
                onClick={openGalleryPicker}
                className="secondary"
                disabled={isAnalyzing || !hasAcceptedTerms || !hasCameraConsent}
              >
                Usar foto de galería
              </button>
            </>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {isAnalyzing && (
          <div className="analysis-progress" role="status" aria-live="polite">
            <p>Procesando imagen: {progress}%</p>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {processMessage && <p className="process-message">{processMessage}</p>}

        {workflowState === 'awaiting-confirmation' && finalDenomination && (
          <div className="confirm-box">
            <h3>Confirmar corte detectado</h3>
            <p>
              Se detectó Serie B con corte estimado <strong>{finalDenomination}</strong>. ¿Es
              correcto?
            </p>

            <div className="confirm-actions">
              <button type="button" onClick={() => handleConfirmDenomination(true)}>
                Sí, es correcto
              </button>
              <button type="button" className="secondary" onClick={() => handleConfirmDenomination(false)}>
                No, corregir
              </button>
            </div>

            <label className="correction-label">
              Si no es correcto, selecciona el corte real:
              <select
                value={manualCorrection}
                onChange={(event) => setManualCorrection(event.target.value as Denomination)}
              >
                <option value="Bs10">Bs10</option>
                <option value="Bs20">Bs20</option>
                <option value="Bs50">Bs50</option>
              </select>
            </label>
          </div>
        )}
      </section>

      <section className="result-panel">
        <h2>Resultado</h2>
        <div className="result-grid">
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
          <p>
            <strong>Denominación por OCR:</strong> {denominationByText ?? 'No detectada'}
          </p>
          <p>
            <strong>Denominación por color:</strong>{' '}
            {denominationByColor
              ? `${denominationByColor} (${Math.round(colorConfidence * 100)}%)`
              : 'No concluyente'}
          </p>
          <p>
            <strong>Denominación final estimada:</strong>{' '}
            {finalDenomination
              ? `${finalDenomination} (${Math.round(finalConfidence * 100)}%)`
              : 'No concluyente'}
          </p>
        </div>

        <p className={isInvalidBill ? 'status-bad' : 'status-ok'}>{statusText}</p>

        {confirmedDenomination && isLegalBill !== null && (
          <p className={isLegalBill ? 'status-ok' : 'status-bad'}>
            Validación final: {confirmedDenomination} Serie B{' '}
            {isLegalBill ? 'legal (fuera de rangos)' : 'sin valor legal (dentro de rangos)'}.
          </p>
        )}

        <div className="result-actions">
          <button
            type="button"
            onClick={resetResults}
            className="secondary"
            disabled={!hasAnyResult && !error}
          >
            Limpiar resultado
          </button>
        </div>
      </section>

      {isTermsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTermsModalOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Términos y Condiciones"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Términos y Condiciones</h2>
            <p>
              Esta app es una herramienta de apoyo y no reemplaza verificaciones oficiales.
              El OCR puede fallar por iluminación, ángulo o calidad de imagen.
            </p>
            <p>
              La decisión final sobre aceptación o rechazo de billetes es responsabilidad del
              usuario.
            </p>
            <p>
              Lee el documento completo aquí:{' '}
              <a href={termsFileUrl} target="_blank" rel="noreferrer">
                Abrir archivo de Términos y Condiciones
              </a>
            </p>

            <div className="modal-actions">
              <button type="button" onClick={() => setIsTermsModalOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {!hasEnteredApp && (
        <div className="modal-overlay" onClick={() => undefined}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Bienvenida">
            <h2>Bienvenido a Validador de Billetes Serie B</h2>
            <p>
              Esta app detecta Serie B, estima el corte (10, 20 o 50) y valida si el serial
              cae dentro de rangos publicados.
            </p>

            <label className="welcome-check">
              <input
                type="checkbox"
                checked={hasAcceptedTerms}
                onChange={(event) => setHasAcceptedTerms(event.target.checked)}
              />
              Acepto Términos y Condiciones.
            </label>

            <label className="welcome-check">
              <input
                type="checkbox"
                checked={hasCameraConsent}
                onChange={(event) => setHasCameraConsent(event.target.checked)}
              />
              Acepto el uso de la cámara.
            </label>

            <button type="button" className="text-button" onClick={() => setIsTermsModalOpen(true)}>
              Leer términos completos
            </button>

            <div className="modal-actions">
              <button
                type="button"
                disabled={!hasAcceptedTerms || !hasCameraConsent}
                onClick={async () => {
                  setHasEnteredApp(true)
                  await startCamera()
                  setWorkflowState('monitoring')
                  setProcessMessage('Monitoreo automático activo. Presenta un billete frente a la cámara.')
                }}
              >
                Ingresar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
