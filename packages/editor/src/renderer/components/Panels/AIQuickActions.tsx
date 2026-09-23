import { useMemo, useState } from 'react';
import {
  StoryNodeType,
  buildDialogueContinuationPrompt,
  buildBranchSuggestionPrompt,
  buildDialoguePolishPrompt,
  buildScriptAdaptationPrompt,
  type CharacterPromptContext,
  type NodePromptContext,
  type StorySemanticSnapshot,
  type StoryNodeDataMap,
} from '@story-blueprint/common';
import styles from './AICommands.module.css';

export interface AIQuickActionsProps {
  semanticSnapshot: StorySemanticSnapshot;
  activeGraphId: string;
  selectedNodes: Array<{ id: string; type: StoryNodeType; data: unknown }>;
  disabled?: boolean;
  onApplyPrompt: (prompt: string, autoSend?: boolean) => void;
}

type QuickActionTab = 'dialogue' | 'branch' | 'polish' | 'adapt' | null;

export function AIQuickActions({
  semanticSnapshot,
  activeGraphId,
  selectedNodes,
  disabled,
  onApplyPrompt,
}: AIQuickActionsProps) {
  const [activeTab, setActiveTab] = useState<QuickActionTab>(null);

  // Character contexts
  const characters = useMemo<CharacterPromptContext[]>(
    () =>
      (semanticSnapshot.characters ?? []).map((char) => ({
        id: char.id,
        name: char.name,
        displayName: char.displayName,
        description: char.description,
        dialogueStyle: char.dialogueStyle,
        tags: char.tags,
        emotions: char.emotions
          ? Object.values(char.emotions).map((emotion) => emotion.displayName)
          : undefined,
      })),
    [semanticSnapshot.characters],
  );

  // Selected node context
  const { sourceNodeContext, selectedDialogueLines } = useMemo(() => {
    const node = selectedNodes[0];
    if (!node) return { sourceNodeContext: undefined, selectedDialogueLines: [] };

    let text = '';
    let speakerName: string | undefined;
    let speakerId: string | undefined;

    let lines: Array<{
      id: string;
      text: string;
      speakerName?: string;
      speakerId?: string;
      emotion?: string;
    }> = [];

    if (node.type === StoryNodeType.Dialogue) {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Dialogue];
      lines = (data.lines ?? []).map((line) => ({
        id: line.id,
        text: line.text?.source ?? '',
        speakerId: line.speakerId,
        speakerName: characters.find((c) => c.id === line.speakerId)?.displayName,
        emotion: line.emotion,
      }));
      const lastLine = lines.at(-1);
      if (lastLine) {
        text = lastLine.text;
        speakerId = lastLine.speakerId;
        speakerName = lastLine.speakerName;
      }
    } else if (node.type === StoryNodeType.Choice) {
      const data = node.data as StoryNodeDataMap[StoryNodeType.Choice];
      text = data.prompt?.source ?? '';
    }

    const sourceContext: NodePromptContext = {
      id: node.id,
      type: node.type,
      text,
      speakerName,
      speakerId,
    };

    return { sourceNodeContext: sourceContext, selectedDialogueLines: lines };
  }, [characters, selectedNodes]);

  // Dialogue continuation state
  const [targetCharId, setTargetCharId] = useState<string>('');
  const [secondCharId, setSecondCharId] = useState<string>('');
  const [speakerMode, setSpeakerMode] = useState<'single' | 'alternating'>('single');
  const [emotion, setEmotion] = useState('');
  const [direction, setDirection] = useState('');
  const [lineCount, setLineCount] = useState(3);
  const [autoConnect, setAutoConnect] = useState(true);

  // Branch suggestion state
  const [choicePrompt, setChoicePrompt] = useState('');
  const [branchCount, setBranchCount] = useState(3);
  const [conflictType, setConflictType] = useState<
    'dilemma' | 'emotional' | 'rational_vs_impulsive' | 'accept_vs_reject' | 'truth_vs_lie' | 'custom'
  >('dilemma');
  const [customConflict, setCustomConflict] = useState('');
  const [includeConsequences, setIncludeConsequences] = useState(true);

  // Polish state
  const [polishGoal, setPolishGoal] = useState<
    'in_character' | 'more_dramatic' | 'more_concise' | 'subtle_hint' | 'custom'
  >('in_character');
  const [customPolishDirection, setCustomPolishDirection] = useState('');

  // Adapt state
  const [scriptText, setScriptText] = useState('');

  const currentTargetChar = useMemo(
    () => characters.find((c) => c.id === targetCharId) ?? characters[0],
    [characters, targetCharId],
  );

  const currentSecondChar = useMemo(
    () => characters.find((c) => c.id === secondCharId),
    [characters, secondCharId],
  );

  const toggleTab = (tab: QuickActionTab) => {
    setActiveTab((current) => (current === tab ? null : tab));
  };

  const handleGenerateDialogue = (autoSend: boolean) => {
    const prompt = buildDialogueContinuationPrompt({
      targetCharacter: currentTargetChar,
      secondCharacter: speakerMode === 'alternating' ? currentSecondChar : undefined,
      speakerMode,
      emotion: emotion || undefined,
      toneOrDirection: direction.trim() || undefined,
      lineCount,
      sourceNode: sourceNodeContext,
      autoConnect: autoConnect && Boolean(sourceNodeContext),
      targetGraph:
        activeGraphId && activeGraphId !== 'root'
          ? { kind: 'chapter', chapterId: activeGraphId }
          : { kind: 'root' },
    });
    onApplyPrompt(prompt, autoSend);
    setActiveTab(null);
  };

  const handleGenerateBranch = (autoSend: boolean) => {
    const prompt = buildBranchSuggestionPrompt({
      sourceNode: sourceNodeContext,
      choicePrompt: choicePrompt.trim() || undefined,
      branchCount,
      conflictType,
      customConflictDescription: customConflict.trim() || undefined,
      includeConsequenceNodes: includeConsequences,
      reactingCharacter: currentTargetChar,
      autoConnect: autoConnect && Boolean(sourceNodeContext),
      targetGraph:
        activeGraphId && activeGraphId !== 'root'
          ? { kind: 'chapter', chapterId: activeGraphId }
          : { kind: 'root' },
    });
    onApplyPrompt(prompt, autoSend);
    setActiveTab(null);
  };

  const handleGeneratePolish = (autoSend: boolean) => {
    const linesToPolish =
      selectedDialogueLines.length > 0
        ? selectedDialogueLines
        : [{ id: 'selected_line', text: 'Selected dialogue line to polish' }];

    const prompt = buildDialoguePolishPrompt({
      lines: linesToPolish,
      targetCharacter: currentTargetChar,
      targetEmotion: emotion || undefined,
      polishGoal,
      customDirection: customPolishDirection.trim() || undefined,
    });
    onApplyPrompt(prompt, autoSend);
    setActiveTab(null);
  };

  const handleGenerateAdapt = (autoSend: boolean) => {
    if (!scriptText.trim()) return;
    const prompt = buildScriptAdaptationPrompt({
      scriptText,
      knownCharacters: characters,
      sourceNode: sourceNodeContext,
      autoConnect: autoConnect && Boolean(sourceNodeContext),
      targetGraph:
        activeGraphId && activeGraphId !== 'root'
          ? { kind: 'chapter', chapterId: activeGraphId }
          : { kind: 'root' },
    });
    onApplyPrompt(prompt, autoSend);
    setActiveTab(null);
  };

  return (
    <div className={styles.quickActionsContainer}>
      <div className={styles.quickActionsBar} role="toolbar" aria-label="AI Story Assistants">
        <button
          type="button"
          className={`${styles.quickActionButton} ${activeTab === 'dialogue' ? styles.quickActionActive : ''}`}
          disabled={disabled}
          onClick={() => toggleTab('dialogue')}
          title="Continue dialogue with character persona"
        >
          💬 对话续写
        </button>
        <button
          type="button"
          className={`${styles.quickActionButton} ${activeTab === 'branch' ? styles.quickActionActive : ''}`}
          disabled={disabled}
          onClick={() => toggleTab('branch')}
          title="Suggest interactive decision branches and consequence reactions"
        >
          🔀 生成分支
        </button>
        <button
          type="button"
          className={`${styles.quickActionButton} ${activeTab === 'polish' ? styles.quickActionActive : ''}`}
          disabled={disabled || selectedDialogueLines.length === 0}
          onClick={() => toggleTab('polish')}
          title={
            selectedDialogueLines.length === 0
              ? 'Select a Dialogue node to polish lines'
              : 'Polish dialogue lines in character voice'
          }
        >
          ✨ 润色台词{selectedDialogueLines.length > 0 ? ` (${selectedDialogueLines.length})` : ''}
        </button>
        <button
          type="button"
          className={`${styles.quickActionButton} ${activeTab === 'adapt' ? styles.quickActionActive : ''}`}
          disabled={disabled}
          onClick={() => toggleTab('adapt')}
          title="Adapt novel or screenplay excerpt into Story Blueprint nodes"
        >
          📖 剧本转蓝图
        </button>
      </div>

      {activeTab === 'dialogue' && (
        <div className={styles.quickActionDrawer}>
          <div className={styles.quickActionHeader}>
            <strong>💬 角色对话续写配置</strong>
            <button
              type="button"
              className={styles.closeDrawerButton}
              onClick={() => setActiveTab(null)}
            >
              ×
            </button>
          </div>

          <div className={styles.quickActionForm}>
            <div className={styles.formRow}>
              <label>
                <span>发言角色</span>
                <select
                  value={targetCharId || (characters[0]?.id ?? '')}
                  onChange={(e) => setTargetCharId(e.target.value)}
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} ({c.name})
                    </option>
                  ))}
                  {characters.length === 0 && <option value="">(暂无角色)</option>}
                </select>
              </label>

              <label>
                <span>对话模式</span>
                <select
                  value={speakerMode}
                  onChange={(e) => setSpeakerMode(e.target.value as 'single' | 'alternating')}
                >
                  <option value="single">单人连续发言/独白</option>
                  <option value="alternating">双人轮流交谈</option>
                </select>
              </label>

              {speakerMode === 'alternating' && (
                <label>
                  <span>交谈对象</span>
                  <select
                    value={secondCharId}
                    onChange={(e) => setSecondCharId(e.target.value)}
                  >
                    <option value="">(请选择交谈角色)</option>
                    {characters
                      .filter((c) => c.id !== (targetCharId || characters[0]?.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName} ({c.name})
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>

            <div className={styles.formRow}>
              {currentTargetChar?.emotions?.length ? (
                <label>
                  <span>角色情绪</span>
                  <select value={emotion} onChange={(e) => setEmotion(e.target.value)}>
                    <option value="">(默认/自然)</option>
                    {currentTargetChar.emotions.map((emo) => (
                      <option key={emo} value={emo}>
                        {emo}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label>
                <span>期望句数</span>
                <select value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))}>
                  <option value={2}>2 句 (短促)</option>
                  <option value={3}>3 句 (适中)</option>
                  <option value={4}>4 句 (完整段落)</option>
                  <option value={6}>6 句 (深入展开)</option>
                </select>
              </label>

              {sourceNodeContext && (
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={autoConnect}
                    onChange={(e) => setAutoConnect(e.target.checked)}
                  />
                  <span>自动连接至选中的节点 ({sourceNodeContext.id})</span>
                </label>
              )}
            </div>

            <div className={styles.formRow}>
              <label className={styles.fullWidthLabel}>
                <span>剧情走向 / 对话主题 (可选)</span>
                <input
                  type="text"
                  placeholder="例如：就昨晚的异常声响互相试探、试图安慰对方、表白..."
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                />
              </label>
            </div>

            <div className={styles.quickActionFooter}>
              <button type="button" onClick={() => handleGenerateDialogue(false)}>
                填入提示词
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => handleGenerateDialogue(true)}
              >
                立即生成
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'branch' && (
        <div className={styles.quickActionDrawer}>
          <div className={styles.quickActionHeader}>
            <strong>🔀 分支剧情选项与展开配置</strong>
            <button
              type="button"
              className={styles.closeDrawerButton}
              onClick={() => setActiveTab(null)}
            >
              ×
            </button>
          </div>

          <div className={styles.quickActionForm}>
            <div className={styles.formRow}>
              <label>
                <span>分支冲突类型</span>
                <select
                  value={conflictType}
                  onChange={(e) =>
                    setConflictType(
                      e.target.value as
                        | 'dilemma'
                        | 'emotional'
                        | 'rational_vs_impulsive'
                        | 'accept_vs_reject'
                        | 'truth_vs_lie'
                        | 'custom',
                    )
                  }
                >
                  <option value="dilemma">两难困境 (各有取舍)</option>
                  <option value="rational_vs_impulsive">理智 vs 冲动 (理性调查 / 热血直接)</option>
                  <option value="emotional">情感羁绊 (互相信任 / 保守提防)</option>
                  <option value="accept_vs_reject">关键抉择 (接受要求 / 果断拒绝)</option>
                  <option value="truth_vs_lie">实话 vs 谎言 (残酷坦白 / 善意隐瞒)</option>
                  <option value="custom">自定义冲突</option>
                </select>
              </label>

              <label>
                <span>选项数量</span>
                <select
                  value={branchCount}
                  onChange={(e) => setBranchCount(Number(e.target.value))}
                >
                  <option value={2}>2 个选项 (经典二选一)</option>
                  <option value={3}>3 个选项 (典型态度分歧)</option>
                  <option value={4}>4 个选项 (丰富选择网)</option>
                </select>
              </label>

              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={includeConsequences}
                  onChange={(e) => setIncludeConsequences(e.target.checked)}
                />
                <span>为每个选项自动生成后续对白节点</span>
              </label>
            </div>

            {conflictType === 'custom' && (
              <div className={styles.formRow}>
                <label className={styles.fullWidthLabel}>
                  <span>自定义冲突描述</span>
                  <input
                    type="text"
                    placeholder="描述各个分支选项背后的对立态度或取向..."
                    value={customConflict}
                    onChange={(e) => setCustomConflict(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div className={styles.formRow}>
              <label className={styles.fullWidthLabel}>
                <span>玩家决策提示语 Prompt (可选)</span>
                <input
                  type="text"
                  placeholder="例如：面对眼前伸出的手，你的决定是..."
                  value={choicePrompt}
                  onChange={(e) => setChoicePrompt(e.target.value)}
                />
              </label>
            </div>

            <div className={styles.quickActionFooter}>
              <button type="button" onClick={() => handleGenerateBranch(false)}>
                填入提示词
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => handleGenerateBranch(true)}
              >
                立即生成
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'polish' && (
        <div className={styles.quickActionDrawer}>
          <div className={styles.quickActionHeader}>
            <strong>✨ 选中文本台词润色配置</strong>
            <button
              type="button"
              className={styles.closeDrawerButton}
              onClick={() => setActiveTab(null)}
            >
              ×
            </button>
          </div>

          <div className={styles.quickActionForm}>
            <div className={styles.formRow}>
              <label>
                <span>目标角色人设</span>
                <select
                  value={targetCharId || (characters[0]?.id ?? '')}
                  onChange={(e) => setTargetCharId(e.target.value)}
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} ({c.name})
                    </option>
                  ))}
                  {characters.length === 0 && <option value="">(暂无角色)</option>}
                </select>
              </label>

              <label>
                <span>润色偏向</span>
                <select
                  value={polishGoal}
                  onChange={(e) =>
                    setPolishGoal(
                      e.target.value as
                        | 'in_character'
                        | 'more_dramatic'
                        | 'more_concise'
                        | 'subtle_hint'
                        | 'custom',
                    )
                  }
                >
                  <option value="in_character">贴合角色个性与口吻</option>
                  <option value="more_dramatic">增强戏剧冲突与张力</option>
                  <option value="more_concise">精简有力，去除冗余</option>
                  <option value="subtle_hint">增加潜台词与含蓄情感</option>
                  <option value="custom">自定义润色要求</option>
                </select>
              </label>

              {currentTargetChar?.emotions?.length ? (
                <label>
                  <span>情绪基调</span>
                  <select value={emotion} onChange={(e) => setEmotion(e.target.value)}>
                    <option value="">(默认/自然)</option>
                    {currentTargetChar.emotions.map((emo) => (
                      <option key={emo} value={emo}>
                        {emo}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            {polishGoal === 'custom' && (
              <div className={styles.formRow}>
                <label className={styles.fullWidthLabel}>
                  <span>自定义润色指示</span>
                  <input
                    type="text"
                    placeholder="例如：加入口吃、傲娇语气、语气冷淡带有讽刺..."
                    value={customPolishDirection}
                    onChange={(e) => setCustomPolishDirection(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div className={styles.quickActionFooter}>
              <button type="button" onClick={() => handleGeneratePolish(false)}>
                填入提示词
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => handleGeneratePolish(true)}
              >
                立即润色
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'adapt' && (
        <div className={styles.quickActionDrawer}>
          <div className={styles.quickActionHeader}>
            <strong>📖 剧本/小说片段转蓝图配置</strong>
            <button
              type="button"
              className={styles.closeDrawerButton}
              onClick={() => setActiveTab(null)}
            >
              ×
            </button>
          </div>

          <div className={styles.quickActionForm}>
            <div className={styles.formRow}>
              <label className={styles.fullWidthLabel}>
                <span>粘贴小说或剧本片段</span>
                <textarea
                  rows={4}
                  placeholder="粘贴小说对话或剧本原文，AI 将自动拆分旁白与角色对白并创建蓝图节点..."
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                />
              </label>
            </div>

            {sourceNodeContext && (
              <div className={styles.formRow}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={autoConnect}
                    onChange={(e) => setAutoConnect(e.target.checked)}
                  />
                  <span>将转换后的首个节点连接至选中的节点 ({sourceNodeContext.id})</span>
                </label>
              </div>
            )}

            <div className={styles.quickActionFooter}>
              <button
                type="button"
                disabled={!scriptText.trim()}
                onClick={() => handleGenerateAdapt(false)}
              >
                填入提示词
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!scriptText.trim()}
                onClick={() => handleGenerateAdapt(true)}
              >
                开始转换
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
