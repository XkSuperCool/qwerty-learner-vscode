import { dictionaries } from './resource/dictionary'
import { DictPickItem } from './typings/index'
import * as vscode from 'vscode'
import cet4 from './assets/CET4_T.json'
import { range } from 'lodash'
import { compareWord, getConfig, getDictFile } from './utils'
import { soundPlayer } from './sound'
import { voicePlayer } from './resource/voice'
import PluginState from './utils/PluginState'

const PLAY_VOICE_COMMAND = 'qwerty-learner.playVoice'
const PREV_WORD_COMMAND = 'qwerty-learner.prevWord'
const NEXT_WORD_COMMAND = 'qwerty-learner.nextWord'

export function activate(context: vscode.ExtensionContext) {
  const pluginState = new PluginState(context)

  const wordBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100)
  const inputBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -101)
  const transBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -102)
  const prevWord = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -103)
  const nextWord = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -104)
  prevWord.text = '<'
  prevWord.tooltip = '切换上一个单词'
  prevWord.command = PREV_WORD_COMMAND
  nextWord.text = '>'
  nextWord.tooltip = '切换下一个单词'
  nextWord.command = NEXT_WORD_COMMAND
  transBar.command = PLAY_VOICE_COMMAND
  transBar.tooltip = '播放发音'

  vscode.workspace.onDidChangeTextDocument((e) => {
    if (!pluginState.isStart) {
      return
    }

    const { uri } = e.document
    // 避免破坏配置文件
    if (uri.scheme.indexOf('vscode') !== -1) {
      return
    }

    const { range, text, rangeLength } = e.contentChanges[0]
    if (!(text !== '' && text.length === 1)) {
      return
    }
    // 删除用户输入的字符
    const newRange = new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character + 1)
    const editAction = new vscode.WorkspaceEdit()
    editAction.delete(uri, newRange)
    vscode.workspace.applyEdit(editAction)
    if (pluginState.hasWrong) {
      return
    }
    soundPlayer('click')
    inputBar.text = pluginState.getCurrentInputBarContent(text)

    const compareResult = pluginState.compareResult
    if (compareResult === -2) {
      // 用户完成单词输入
      soundPlayer('success')
      pluginState.finishWord()
      initializeBar()
    } else if (compareResult >= 0) {
      pluginState.wrongInput()
      inputBar.color = pluginState.highlightWrongColor
      soundPlayer('wrong')
      setTimeout(() => {
        pluginState.clearWrong()
        inputBar.color = undefined
        initializeBar()
      }, pluginState.highlightWrongDelay)
    }
  })

  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('qwerty-learner.placeholder')) {
      pluginState.placeholder = getConfig('placeholder')
      initializeBar()
    }

    if (event.affectsConfiguration('qwerty-learner.chapterLength')) {
      pluginState.chapterLength = getConfig('chapterLength')
      initializeBar()
    }
  })

  // 注册 vscode commands
  context.subscriptions.push(
    ...[
      vscode.commands.registerCommand('qwerty-learner.start', () => {
        pluginState.isStart = !pluginState.isStart
        if (pluginState.isStart) {
          initializeBar()
          wordBar.show()
          inputBar.show()
          transBar.show()
          prevWord.show()
          nextWord.show()
          if (pluginState.readOnlyMode) {
            setUpReadOnlyInterval()
          }
        } else {
          wordBar.hide()
          inputBar.hide()
          transBar.hide()
          prevWord.hide()
          nextWord.hide()
          removeReadOnlyInterval()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.changeChapter', async () => {
        const inputChapter = await vscode.window.showQuickPick(
          range(1, pluginState.totalChapters + 1).map((i) => i.toString()),
          { placeHolder: `当前章节: ${pluginState.chapter + 1}   共 ${pluginState.totalChapters}章节` },
        )
        if (inputChapter !== undefined) {
          pluginState.chapter = parseInt(inputChapter) - 1
          initializeBar()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.changeDict', async () => {
        const dictList: DictPickItem[] = []
        dictionaries.forEach((dict) => {
          dictList.push({ label: dict.name, path: dict.url, detail: dict.description, key: dict.id })
        })
        const inputDict = await vscode.window.showQuickPick(dictList, { placeHolder: `当前字典: ${pluginState.dict.name}` })
        if (inputDict !== undefined) {
          pluginState.dictKey = inputDict.key
          initializeBar()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleWordVisibility', () => {
        pluginState.wordVisibility = !pluginState.wordVisibility
        initializeBar()
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleReadOnlyMode', () => {
        pluginState.readOnlyMode = !pluginState.readOnlyMode
        if (pluginState.readOnlyMode) {
          setUpReadOnlyInterval()
        } else {
          removeReadOnlyInterval()
        }
      }),
      vscode.commands.registerCommand(PLAY_VOICE_COMMAND, playVoice),
      vscode.commands.registerCommand(PREV_WORD_COMMAND, () => {
        pluginState.prevWord()
        initializeBar()
      }),
      vscode.commands.registerCommand(NEXT_WORD_COMMAND, () => {
        pluginState.nextWord()
        initializeBar()
      }),
    ],
  )

  function initializeBar() {
    setUpWordBar()
    setUpTransBar()
    setUpInputBar()
  }
  function playVoice() {
    if (pluginState.shouldPlayVoice) {
      pluginState.voiceLock = true
      voicePlayer(pluginState.currentWord.name, () => {
        pluginState.voiceLock = false
      })
    }
  }
  function setUpWordBar() {
    wordBar.text = pluginState.getInitialWordBarContent()
    playVoice()
  }
  function setUpTransBar() {
    transBar.text = pluginState.getInitialTransBarContent()
  }
  function setUpInputBar() {
    inputBar.text = pluginState.getInitialInputBarContent()
  }

  function setUpReadOnlyInterval() {
    if (!pluginState.readOnlyIntervalId) {
      pluginState.readOnlyIntervalId = setInterval(() => {
        pluginState.finishWord()
        initializeBar()
      }, pluginState.readOnlyInterval)
    }
  }
  function removeReadOnlyInterval() {
    if (pluginState.readOnlyIntervalId) {
      clearInterval(pluginState.readOnlyIntervalId)
      pluginState.readOnlyIntervalId = null
    }
  }
}
