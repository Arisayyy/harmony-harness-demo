import { Effect } from "effect"

// Terminal-cell raster generated from the Harmony mark. Keeping image decoding
// out of the hot path makes startup deterministic across terminal emulators.
const mark = [
  "                                                                ###     ",
  "                                                             #######    ",
  "                                                           #########    ",
  "                                                         #########      ",
  "                                                      ##########        ",
  "                                                    #########           ",
  "                                                 ##########             ",
  "                                               ##########               ",
  "                                             #########                  ",
  " ########                                 ##########                    ",
  " ############                           ##########                      ",
  "   ##############                   ###########                         ",
  "       ######################################        ##                 ",
  "           ###############################         ######               ",
  "               #########################        #########               ",
  "                   ###################        #########                 ",
  "                     ##############         #########                   ",
  "                      ###########        ##########                     ",
  "                     ##########        ############                     ",
  "                   #########        ###############                     ",
  "                 #########        ####################                  ",
  "               #########        ##########################              ",
  "               ######        #################################          ",
  "                           ##############          ###############      ",
  "                         ##########                     ##############  ",
  "                      ##########                            ########### ",
  "                    #########                                   ####### ",
  "                  #########                                             ",
  "               ##########                                               ",
  "             #########                                                  ",
  "           #########                                                    ",
  "        ##########                                                      ",
  "      #########                                                         ",
  "    #########                                                           ",
  "    ######                                                              "
] as const

const sourceWidth = mark[0].length
const sourceHeight = mark.length
// Match the industrial black-and-safety-yellow palette used by the home TUI.
const background = { red: 7, green: 12, blue: 8 }
const foreground = { red: 202, green: 214, blue: 75 }
const clear = "\u001b[2J\u001b[H"
const hideCursor = "\u001b[?25l"
const showCursor = "\u001b[?25h"
const reset = "\u001b[0m"

interface Point {
  readonly x: number
  readonly y: number
}

const color = (red: number, green: number, blue: number) => `\u001b[38;2;${red};${green};${blue}m`
const backgroundColor = `\u001b[48;2;${background.red};${background.green};${background.blue}m`
const cursorAt = (x: number, y: number) => `\u001b[${y + 1};${x + 1}H`
const easeOutCubic = (value: number) => 1 - ((1 - value) ** 3)

const scaledMark = (columns: number, rows: number): ReadonlyArray<Point> => {
  const availableWidth = Math.max(12, columns - 2)
  const availableHeight = Math.max(6, rows - 2)
  const width = Math.max(12, Math.min(availableWidth, availableHeight * 2))
  const height = Math.max(6, Math.min(availableHeight, Math.round(width / 2)))
  const left = Math.floor((columns - width) / 2)
  const top = Math.floor((rows - height) / 2)
  const points: Array<Point> = []

  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height))
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width))
      if (mark[sourceY]?.[sourceX] === "#") points.push({ x: left + x, y: top + y })
    }
  }
  return points
}

const draw = (points: ReadonlyArray<Point>, shade: string) => {
  const cells = new Set(points.map(({ x, y }) => `${x}:${y}`))
  return `${clear}${backgroundColor}${shade}${[...cells].map((cell) => {
    const [x, y] = cell.split(":").map(Number)
    return `${cursorAt(x ?? 0, y ?? 0)}█`
  }).join("")}`
}

const blend = (from: number, to: number, amount: number) => Math.round(from + ((to - from) * amount))

/** A quick, native terminal interpretation of TerminalTextEffects' Expand effect. */
const animateSplash = Effect.gen(function*() {
  const columns = Math.max(20, process.stdout.columns ?? 92)
  const rows = Math.max(10, process.stdout.rows ?? 24)
  const points = scaledMark(columns, rows)
  const centerX = (columns - 1) / 2
  const centerY = (rows - 1) / 2

  process.stdout.write(`${hideCursor}${backgroundColor}${clear}`)
  yield* Effect.sleep("90 millis")
  for (const [step, frameTime] of [[0.08, 52], [0.22, 53], [0.42, 52], [0.65, 53], [0.84, 52], [1, 53]] as const) {
    const progress = easeOutCubic(step)
    const expanded = points.map(({ x, y }) => ({
      x: Math.round(centerX + ((x - centerX) * progress)),
      y: Math.round(centerY + ((y - centerY) * progress))
    }))
    process.stdout.write(draw(expanded, color(foreground.red, foreground.green, foreground.blue)))
    yield* Effect.sleep(`${frameTime} millis`)
  }

  yield* Effect.sleep("68 millis")
  for (const amount of [0.25, 0.5, 0.75, 1]) {
    process.stdout.write(draw(points, color(
      blend(foreground.red, background.red, amount),
      blend(foreground.green, background.green, amount),
      blend(foreground.blue, background.blue, amount)
    )))
    yield* Effect.sleep("45 millis")
  }
}).pipe(Effect.ensuring(Effect.sync(() => process.stdout.write(`${reset}${showCursor}${clear}`))))

export const playSplash = Effect.suspend(() => process.stdout.isTTY ? animateSplash : Effect.void)
