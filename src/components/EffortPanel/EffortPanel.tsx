import * as React from 'react';
import { BaseText, Box, Text, useTerminalSize } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { type EffortValue, getDisplayedEffortLevel, getEffortEnvOverride } from '../../utils/effort.js';
import {
  type PanelPosition,
  CANCEL_MESSAGE,
  computeConfirmOutcome,
  getInitialCursor,
  moveLeft,
  moveRight,
  PANEL_POSITIONS,
} from './effortPanelState.js';
import { executeEffort } from '../../commands/effort/effort.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useSetAppState } from '../../state/AppState.js';
import { useRippleFrame } from './useRippleFrame.js';
import {
  TRANSPARENT,
  type Overlay,
  type RipplePalette,
  type Segment,
  applyOverlaysToCells,
  cellsToSegments,
  computeRippleCells,
  fadeCells,
  getHueShiftAtTime,
  rotateHue,
} from './rippleAnimation.js';

/**
 * 每档最小宽度（足够装下 'ultracode' 9 字符 + 居中留白）。
 * 当终端窄时使用此值，保证最低可读性。
 */
const MIN_SEGMENT = 12;

const SUBLABEL_ULTRACODE = 'xhigh + workflows';
const MAX_EFFORT_WARNING =
  'May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks.';

// 颜色：与项目主题对齐（suggestion=Medium blue #5769F7）。
const COLOR_LABEL_SELECTED = '#5769F7'; // 选中档位（suggestion）
const COLOR_LABEL_DEFAULT = '#7a8eff'; // 未选中档位（淡紫蓝，与波纹背景协调）
const COLOR_OVERLAY = '#5769F7'; // Faster / Smarter / ▲ 等 overlay 文字
const COLOR_ULTRACODE = '#a56bff';

// 淡入淡出每帧步长：60ms 间隔下 5 帧达到目标 ≈ 300ms 动画时长。
const FADE_STEP = 0.2;

// 波纹震源 y 坐标（相对波纹区域坐标系，y=0 是档位名行）。
const RIPPLE_SOURCE_Y = 0;

/**
 * 根据终端宽度计算每档实际宽度（SEGMENT）。
 *
 * 规则：
 * - 留出 paddingX={1} 的左右各 1 列 → 可用宽度 = columns - 2
 * - 若可用宽度 <= MIN_SEGMENT * 6（72），用 MIN_SEGMENT（保持当前窄布局）
 * - 否则铺满：floor(可用宽度 / 6)
 *
 * 即"窄则不变，宽则铺满"。最小宽度保证 'ultracode' 9 字符能正常显示。
 */
function computeSegment(terminalColumns: number): number {
  const available = terminalColumns - 2; // paddingX={1} 两侧
  const minNeeded = MIN_SEGMENT * PANEL_POSITIONS.length;
  if (available <= minNeeded) return MIN_SEGMENT;
  return Math.floor(available / PANEL_POSITIONS.length);
}

/**
 * 计算波纹震源 x 坐标（ultracode 段内 'ultracode' 标签的中心列）。
 *
 * 'ultracode' 是 9 字符，在 SEGMENT 列内居中：
 *   offset = floor((SEGMENT - 9) / 2)
 *   labelCenter = SEGMENT * 5 + offset + 4  （4 是 9 字符串的中心偏移）
 *
 * SEGMENT=12 → 60 + 1 + 4 = 65（与历史值一致）
 * SEGMENT=20 → 100 + 5 + 4 = 109
 */
function computeRippleSourceX(segment: number, mode: RipplePalette): number {
  const position: PanelPosition = mode === 'rainbow' ? 'max' : 'ultracode';
  return (
    segmentTextStartX(PANEL_POSITIONS.indexOf(position), position.length, segment) + Math.floor(position.length / 2)
  );
}

/**
 * 计算某段 idx 内居中文字的起始列。
 * 动态 segment：textLen 字符在 segment 列内居中。
 */
function segmentTextStartX(idx: number, textLen: number, segment: number): number {
  return segment * idx + Math.max(0, Math.floor((segment - textLen) / 2));
}

type Props = {
  appStateEffort: EffortValue | undefined;
  onDone: (message: string) => void;
};

export function EffortPanel({ appStateEffort, onDone }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const model = useMainLoopModel();
  const { columns } = useTerminalSize();

  // 自适应宽度：根据终端列数计算每档宽度。
  // 终端变化（resize）时 columns 改变 → 重新计算 → 重渲染。
  const segment = React.useMemo(() => computeSegment(columns), [columns]);
  const panelWidth = segment * PANEL_POSITIONS.length;

  const envOverride = getEffortEnvOverride();
  const displayed = getDisplayedEffortLevel(model, appStateEffort);
  const initialCursor = getInitialCursor({ envOverride, appStateEffort, displayed });

  const [cursor, setCursor] = React.useState<PanelPosition>(initialCursor);
  const [done, setDone] = React.useState(false);

  const activeRippleMode: RipplePalette | null =
    cursor === 'max' ? 'rainbow' : cursor === 'ultracode' ? 'purple' : null;
  const [lastRippleMode, setLastRippleMode] = React.useState<RipplePalette>(activeRippleMode ?? 'purple');
  const rippleMode = activeRippleMode ?? lastRippleMode;
  const rippleSourceX = React.useMemo(() => computeRippleSourceX(segment, rippleMode), [segment, rippleMode]);
  const [fade, setFade] = React.useState(0);
  // max 使用彩虹波纹，ultracode 使用固定紫色波纹；移出时保留淡出帧。
  const showingRipple = activeRippleMode !== null || fade > 0.001;
  const [rippleRef, time] = useRippleFrame(showingRipple);

  React.useEffect(() => {
    if (activeRippleMode !== null) setLastRippleMode(activeRippleMode);
  }, [activeRippleMode]);

  // 淡入淡出驱动：每 tick（time 推进）朝目标步进 FADE_STEP。
  // 退出动画完成后 fade 归零，showingRipple 变 false，时钟停止订阅。
  React.useEffect(() => {
    if (!showingRipple) return;
    const target = activeRippleMode !== null ? 1 : 0;
    setFade(prev => {
      if (prev === target) return prev;
      const next = target > prev ? prev + FADE_STEP : prev - FADE_STEP;
      return target > prev ? Math.min(target, next) : Math.max(target, next);
    });
  }, [time, activeRippleMode, showingRipple]);

  const handleConfirm = React.useCallback(() => {
    if (done) return;
    setDone(true);
    const outcome = computeConfirmOutcome(cursor, executeEffort);
    if (outcome.kind === 'apply' && outcome.effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: outcome.effortUpdate!.value,
      }));
    }
    onDone(outcome.message);
  }, [cursor, done, onDone, setAppState]);

  const handleCancel = React.useCallback(() => {
    if (done) return;
    setDone(true);
    onDone(CANCEL_MESSAGE);
  }, [done, onDone]);

  useKeybindings(
    {
      'effortPanel:decrease': () => setCursor(c => moveLeft(c)),
      'effortPanel:increase': () => setCursor(c => moveRight(c)),
      'effortPanel:home': () => setCursor('low'),
      'effortPanel:end': () => setCursor('ultracode'),
      'effortPanel:confirm': handleConfirm,
      'effortPanel:cancel': handleCancel,
    },
    { context: 'EffortPanel' },
  );

  const envActive = envOverride !== null && envOverride !== undefined;
  const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;

  // 波纹行 cells 计算：返回该行所有 cell（含 overlay 文字）
  // fade 控制背景颜色亮度（0 → 全 transparent，1 → 完整波纹）。
  // 文字 overlay 也乘以 fade，让进入/退出动画整体淡入淡出。
  const renderRippleRow = React.useCallback(
    (relY: number, overlays: Overlay[]): Segment[] => {
      const cells = computeRippleCells({
        y: relY + RIPPLE_SOURCE_Y,
        width: panelWidth,
        time,
        sourceX: rippleSourceX,
        sourceY: RIPPLE_SOURCE_Y,
        palette: rippleMode,
      });
      const overlayed = applyOverlaysToCells(cells, overlays);
      const faded = fadeCells(overlayed, fade);
      return cellsToSegments(faded);
    },
    [time, fade, panelWidth, rippleSourceX, rippleMode],
  );

  return (
    <Box ref={rippleRef} flexDirection="column" paddingX={1} width={panelWidth + 2}>
      <Text bold color="suggestion">
        Effort
      </Text>
      {envActive && <Text color="warning">{`⚠ CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session`}</Text>}
      {showingRipple ? (
        <RippleContent
          renderRow={renderRippleRow}
          cursor={cursor}
          fade={fade}
          segment={segment}
          panelWidth={panelWidth}
          time={time}
          mode={rippleMode}
        />
      ) : (
        <PlainContent cursor={cursor} segment={segment} panelWidth={panelWidth} />
      )}
      {cursor === 'max' && (
        <Box marginTop={1}>
          <Text color="warning">{MAX_EFFORT_WARNING}</Text>
        </Box>
      )}
    </Box>
  );
}

// ---- 普通模式（无波纹）----

function PlainContent({
  cursor,
  segment,
  panelWidth,
}: {
  cursor: PanelPosition;
  segment: number;
  panelWidth: number;
}): React.ReactNode {
  return (
    <>
      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text color="suggestion">Faster</Text>
        <Text color="suggestion">Smarter</Text>
      </Box>
      <TrackRow cursor={cursor} segment={segment} panelWidth={panelWidth} />
      <Box flexDirection="row">
        {PANEL_POSITIONS.map(p => (
          <Box key={`label-${p}`} width={segment} justifyContent="center">
            <Text bold={cursor === p} color={cursor === p ? 'suggestion' : 'subtle'}>
              {p}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        <Box width={segment * (PANEL_POSITIONS.length - 1)} />
        <Box width={segment} justifyContent="center">
          <Text color="subtle">{SUBLABEL_ULTRACODE}</Text>
        </Box>
      </Box>
    </>
  );
}

function TrackRow({
  cursor,
  segment,
  panelWidth,
}: {
  cursor: PanelPosition;
  segment: number;
  panelWidth: number;
}): React.ReactNode {
  const cursorX = segmentTextStartX(PANEL_POSITIONS.indexOf(cursor), 1, segment);
  const ultracodeStart = segment * (PANEL_POSITIONS.length - 1);
  return (
    <Box flexDirection="row">
      <Text color="subtle">{'─'.repeat(cursorX)}</Text>
      <Text bold color="suggestion">
        ▲
      </Text>
      <Text color="subtle">{'─'.repeat(Math.max(0, ultracodeStart - cursorX - 1))}</Text>
      <Text color={COLOR_ULTRACODE}>┆{'─'.repeat(Math.max(0, panelWidth - ultracodeStart - 1))}</Text>
    </Box>
  );
}

// ---- 波纹模式（cursor === 'ultracode'）----
//
// 渲染策略：
// - 每行先 computeRippleCells 算出强度→颜色的 cell 数组（背景为空格 + 颜色）
// - applyOverlaysToCells 把文字 overlay（Faster/▲/档位名/副标签）写入对应 cell
// - cellsToSegments 合并相邻同色段
// - 渲染层遍历 segments：每个段判断是"空格波纹段"还是"文字段"
//   - 空格段：用 backgroundColor 把空格染成色块（pure color block）
//   - 文字段：用 color 染色文字（背景保持终端默认，让文字最清晰）
//   - 混合段（既有空格又有文字，少见）：拆为前后两个 Text
//
// 注意：Segment 内可能同时有空格和非空格字符（如 "  Faster  " 居中文字）。
// 这种段用 color 渲染时，空格部分不显示色块——视觉上"色块断裂"。
// 解决：渲染时把 segment 按字符类型二次拆分（runs of whitespace vs non-whitespace）。

type RippleContentProps = {
  renderRow: (relY: number, overlays: Overlay[]) => Segment[];
  cursor: PanelPosition;
  fade: number;
  segment: number;
  panelWidth: number;
  time: number;
  mode: RipplePalette;
};

function RippleContent({ renderRow, cursor, segment, panelWidth, time, mode }: RippleContentProps): React.ReactNode {
  // 光标索引跟随 cursor（退出动画期间 cursor 已移到别处，
  // 让 ▲ overlay 跟着移走，ultracode 段恢复普通背景色）。
  const cursorIdx = PANEL_POSITIONS.indexOf(cursor);
  // 副标签固定在 ultracode 段下方，不跟随光标移动。
  const ultracodeIdx = PANEL_POSITIONS.length - 1;

  // 文字颜色跟随波浪色相旋转：取当前 time 的 hueShift，
  // 应用到所有 overlay 颜色，让文字与背景色环保持同步。
  const hueShift = mode === 'rainbow' ? getHueShiftAtTime(time) : 0;
  const overlayColor = mode === 'rainbow' ? rotateHue(COLOR_OVERLAY, hueShift) : COLOR_ULTRACODE;
  const labelSelectedColor = mode === 'rainbow' ? rotateHue(COLOR_LABEL_SELECTED, hueShift) : COLOR_ULTRACODE;
  const labelDefaultColor = mode === 'rainbow' ? rotateHue(COLOR_LABEL_DEFAULT, hueShift) : COLOR_LABEL_DEFAULT;

  const fasterOverlay: Overlay = { text: 'Faster', x: 0, color: overlayColor };
  const smarterOverlay: Overlay = {
    text: 'Smarter',
    x: panelWidth - 'Smarter'.length,
    color: overlayColor,
  };
  const separatorOverlay: Overlay = {
    text: '─'.repeat(panelWidth),
    x: 0,
    color: labelDefaultColor,
  };
  const ultracodeTrackOverlay: Overlay = {
    text: `┆${'─'.repeat(segment - 1)}`,
    x: segment * ultracodeIdx,
    color: COLOR_ULTRACODE,
  };
  const cursorOverlay: Overlay = {
    text: '▲',
    x: segmentTextStartX(cursorIdx, 1, segment),
    color: overlayColor,
  };
  const labelOverlays: Overlay[] = PANEL_POSITIONS.flatMap((p, idx) => {
    const x = segmentTextStartX(idx, p.length, segment);
    if (p === 'max' && cursor === 'max') {
      return [...p].map((char, charIdx) => ({
        text: char,
        x: x + charIdx,
        color: rotateHue(COLOR_LABEL_SELECTED, hueShift + charIdx * 90),
      }));
    }
    return [
      {
        text: p,
        x,
        color: p === 'ultracode' ? COLOR_ULTRACODE : p === cursor ? labelSelectedColor : labelDefaultColor,
      },
    ];
  });
  const sublabelOverlay: Overlay = {
    text: SUBLABEL_ULTRACODE,
    x: segmentTextStartX(ultracodeIdx, SUBLABEL_ULTRACODE.length, segment),
    color: labelDefaultColor,
  };

  // 各行 y 坐标（相对震源 RIPPLE_SOURCE_Y = 档位名行）
  //   y=-4: 顶部纯波纹行（视觉一致，无 overlay）
  //   y=-3: Faster/Smarter
  //   y=-2: 分隔线
  //   y=-1: ▲
  //   y=0:  档位名（震源）
  //   y=1:  副标签
  //   y=2:  底部纯波纹行（视觉一致，无 overlay）
  //
  // 快捷键行：plain Text，不参与波纹渲染（无背景动画），紧贴底部波纹行。
  return (
    <>
      <RippleRow segments={renderRow(-2, [fasterOverlay, smarterOverlay])} />
      <RippleRow segments={renderRow(-1, [separatorOverlay, ultracodeTrackOverlay, cursorOverlay])} />
      <RippleRow segments={renderRow(0, labelOverlays)} />
      <RippleRow segments={renderRow(1, [sublabelOverlay])} />
    </>
  );
}

/**
 * 渲染一行波纹 segments。
 *
 * 每个 segment 可能含空格 + 文字混合（如 "  Faster  "）：
 * - 空格部分用 backgroundColor 染色块（波纹颜色）
 * - 文字部分用 color 染色（亮色，背景保持终端默认）
 *
 * 简化策略：遍历 segment 字符，按"是否为空格"二次拆分为 token。
 * 相邻同类型 token 合并，避免 React key 爆炸。
 */
function RippleRow({ segments }: { segments: Segment[] }): React.ReactNode {
  const tokens: Array<{ text: string; kind: 'space' | 'text'; color: string }> = [];
  for (const seg of segments) {
    // 拆分 seg.text 为空格段和非空格段
    let buf = '';
    let bufIsSpace: boolean | null = null;
    const flush = (): void => {
      if (buf === '' || bufIsSpace === null) return;
      tokens.push({
        text: buf,
        kind: bufIsSpace ? 'space' : 'text',
        color: seg.color,
      });
      buf = '';
      bufIsSpace = null;
    };
    for (const ch of seg.text) {
      const isSpace = ch === ' ';
      if (bufIsSpace === null) {
        buf = ch;
        bufIsSpace = isSpace;
      } else if (isSpace === bufIsSpace) {
        buf += ch;
      } else {
        flush();
        buf = ch;
        bufIsSpace = isSpace;
      }
    }
    flush();
  }

  return (
    <Box flexDirection="row">
      {tokens.map((tok, i) =>
        tok.kind === 'space' ? (
          tok.color === TRANSPARENT ? (
            <BaseText key={i}>{tok.text}</BaseText>
          ) : (
            <BaseText key={i} backgroundColor={tok.color as `#${string}`}>
              {tok.text}
            </BaseText>
          )
        ) : (
          <Text key={i} color={tok.color as `#${string}`} bold>
            {tok.text}
          </Text>
        ),
      )}
    </Box>
  );
}
