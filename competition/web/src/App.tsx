import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BotInfo,
  PlayerInfo,
  GameState,
  GameResult,
  GameWinReason,
  MatchResult,
  RecordedGame,
  RoundRobinStanding,
  TournamentState,
} from './lib/types';
import { GameEngine } from './lib/game-engine';
import { BotSelector } from './components/BotSelector';
import { GameBoard } from './components/GameBoard';
import { MoveHistory } from './components/MoveHistory';
import { GameControls } from './components/GameControls';
import { TournamentBracket } from './components/TournamentBracket';
import { createBracketsTournament, getCurrentMatches, updateMatchResult } from './lib/brackets-tournament';
import './App.css';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const initialGameState: GameState = {
  status: 'idle',
  result: null,
  fen: INITIAL_FEN,
  moves: [],
  currentTurn: 'w',
  whitePlayer: null,
  blackPlayer: null,
  lastMoveTimeMs: 0,
  timeLimitMs: 10000,
};

function App() {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [selectedTournamentBots, setSelectedTournamentBots] = useState<Set<string>>(new Set());
  const [whitePlayer, setWhitePlayer] = useState<PlayerInfo | null>(null);
  const [blackPlayer, setBlackPlayer] = useState<PlayerInfo | null>(null);
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveDelay, setMoveDelay] = useState(500);
  const [timeLimitMs, setTimeLimitMs] = useState(10000);
  const [tournament, setTournament] = useState<TournamentState | null>(null);
  const [tournamentRunning, setTournamentRunning] = useState(false);
  const engineRef = useRef<GameEngine | null>(null);
  const [replayGame, setReplayGame] = useState<RecordedGame | null>(null);
  const [replayMoveIndex, setReplayMoveIndex] = useState(-1);

  // Fetch manifest on mount
  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    fetch(`${base}bots/manifest.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
        return res.json();
      })
      .then((data: BotInfo[]) => {
        // ensure undefined updatedAt is normalized to undefined
        const normalized = data.map((b) => ({ ...b, updatedAt: b.updatedAt || undefined }));
        setBots(normalized);
      })
      .catch((err) => setError(`Could not load bot list: ${err.message}`));
  }, []);

  // State change callback for engine
  const onStateChange = useCallback((state: GameState) => {
    setGameState(state);
  }, []);

  // Initialize engine
  useEffect(() => {
    engineRef.current = new GameEngine(onStateChange);
    return () => {
      engineRef.current?.cleanup();
    };
  }, [onStateChange]);

  // Update move delay in engine
  useEffect(() => {
    engineRef.current?.setMoveDelay(moveDelay);
  }, [moveDelay]);

  // Update time limit in engine
  useEffect(() => {
    engineRef.current?.setTimeLimit(timeLimitMs);
  }, [timeLimitMs]);

  const getWinnerColor = (result: GameResult): 'w' | 'b' | null => {
    if (!result) return null;
    if (result.type === 'checkmate') return result.winner;
    if (result.type === 'forfeit') return result.loser === 'w' ? 'b' : 'w';
    return null;
  };

  const getMoveTimeTotals = (moves: GameState['moves']): { white: number; black: number } => {
    return moves.reduce(
      (acc, move) => {
        if (move.color === 'w') {
          acc.white += move.timeMs;
        } else {
          acc.black += move.timeMs;
        }
        return acc;
      },
      { white: 0, black: 0 },
    );
  };

  const formatReason = (reason: string): string => {
    const map: Record<string, string> = {
      checkmate: 'checkmate',
      stalemate: 'stalemate',
      timeout: 'timeout',
      'invalid-move': 'invalid move',
      'draw-repetition': 'draw (repetition)',
      'draw-insufficient': 'draw (insufficient material)',
      'draw-50-move': 'draw (50-move rule)',
      forfeit: 'forfeit',
      'time-advantage': 'time advantage',
    };
    return map[reason] ?? reason;
  };

  const getGameWinReason = (result: GameResult): GameWinReason => {
    if (!result) return 'draw-50-move';
    if (result.type === 'checkmate') return 'checkmate';
    if (result.type === 'stalemate') return 'stalemate';
    if (result.type === 'draw-repetition') return 'draw-repetition';
    if (result.type === 'draw-insufficient') return 'draw-insufficient';
    if (result.type === 'draw-50-move') return 'draw-50-move';
    if (result.type === 'forfeit') {
      return result.reason === 'timeout' ? 'timeout' : 'invalid-move';
    }
    return 'draw-50-move';
  };

  /** Play a single game and return the raw result + full move recording. */
  const playSingleGame = async (
    white: BotInfo,
    black: BotInfo,
  ): Promise<{
    winnerColor: 'w' | 'b' | null;
    reason: GameWinReason;
    isDraw: boolean;
    totals: { white: number; black: number };
    recording: RecordedGame;
  }> => {
    if (!engineRef.current) throw new Error('Game engine not ready');

    setWhitePlayer({ type: 'bot', bot: white });
    setBlackPlayer({ type: 'bot', bot: black });
    await engineRef.current.loadPlayers(
      { type: 'bot', bot: white },
      { type: 'bot', bot: black },
    );
    await engineRef.current.play();

    const state = engineRef.current.getState();
    if (state.status !== 'finished') throw new Error('Match aborted');

    const totals = getMoveTimeTotals(state.moves);
    const winnerColor = getWinnerColor(state.result);
    const reason = getGameWinReason(state.result);
    const isDraw =
      !!state.result &&
      (state.result.type === 'stalemate' ||
        state.result.type === 'draw-repetition' ||
        state.result.type === 'draw-insufficient' ||
        state.result.type === 'draw-50-move');

    // Snapshot the full game for replay
    const recording: RecordedGame = {
      whiteBot: white,
      blackBot: black,
      moves: [...state.moves],
      result: state.result,
      reason,
    };

    return { winnerColor, reason, isDraw, totals, recording };
  };

  /**
   * Play a match between two bots.
   *
   * 1. Game 1: whiteBot plays white, blackBot plays black.
   * 2. If the game is a draw, play a rematch with swapped colours.
   * 3. If the rematch is also a draw, the winner is the bot that spent
   *    less total thinking time across both games.
   */
  const playBotMatch = async (
    whiteBot: BotInfo,
    blackBot: BotInfo,
  ): Promise<{
    winner: BotInfo;
    loser: BotInfo;
    gameResults: MatchResult[];
    matchTotalTimeMs: Record<string, number>;
    recordings: RecordedGame[];
  }> => {
    if (!engineRef.current) {
      throw new Error('Game engine not ready');
    }

    const originalTimeLimit = engineRef.current.getTimeLimit();
    engineRef.current.setTimeLimit(timeLimitMs);

    const matchTotalTimeMs: Record<string, number> = { [whiteBot.username]: 0, [blackBot.username]: 0 };
    const gameResults: MatchResult[] = [];
    const recordings: RecordedGame[] = [];

    try {
      // ── Game 1 ──────────────────────────────────────────────
      const g1 = await playSingleGame(whiteBot, blackBot);
      matchTotalTimeMs[whiteBot.username] += g1.totals.white;
      matchTotalTimeMs[blackBot.username] += g1.totals.black;
      recordings.push(g1.recording);

      if (!g1.isDraw) {
        const winner = g1.winnerColor === 'w' ? whiteBot : blackBot;
        const loser = winner === whiteBot ? blackBot : whiteBot;
        gameResults.push({ winner, loser, reason: g1.reason });
        return { winner, loser, gameResults, matchTotalTimeMs, recordings };
      }

      // Game 1 was a draw — record it and play a rematch with swapped colours
      gameResults.push({ winner: whiteBot, loser: blackBot, reason: 'draw' });

      // ── Game 2 (rematch, colours swapped) ───────────────────
      const g2 = await playSingleGame(blackBot, whiteBot);
      matchTotalTimeMs[blackBot.username] += g2.totals.white;
      matchTotalTimeMs[whiteBot.username] += g2.totals.black;
      recordings.push(g2.recording);

      if (!g2.isDraw) {
        const winner = g2.winnerColor === 'w' ? blackBot : whiteBot;
        const loser = winner === whiteBot ? blackBot : whiteBot;
        gameResults.push({ winner, loser, reason: g2.reason });
        return { winner, loser, gameResults, matchTotalTimeMs, recordings };
      }

      // Both games drawn — tiebreak by total thinking time
      gameResults.push({ winner: blackBot, loser: whiteBot, reason: 'draw' });

      const winner =
        matchTotalTimeMs[whiteBot.username] <= matchTotalTimeMs[blackBot.username]
          ? whiteBot
          : blackBot;
      const loser = winner === whiteBot ? blackBot : whiteBot;
      gameResults.push({ winner, loser, reason: 'time-advantage' });
      return { winner, loser, gameResults, matchTotalTimeMs, recordings };
    } finally {
      engineRef.current.setTimeLimit(originalTimeLimit);
    }
  };

  const handleStartTournament = async () => {
    const useBots = bots.filter((b) => selectedTournamentBots.has(b.username));
    if (tournamentRunning || useBots.length < 2) return;
    setError(null);
    setTournamentRunning(true);
    try {
      const ctx = await createBracketsTournament(useBots);
      const { manager, storage, stageId, participantMap } = ctx;

      const trackHeadToHead = (h2h: Record<string, { wins: number; losses: number }>, winner: BotInfo, loser: BotInfo) => {
        const names = [winner.username, loser.username].sort();
        const key = names.join('-vs-');
        if (!h2h[key]) h2h[key] = { wins: 0, losses: 0 };
        if (winner.username === names[0]) h2h[key].wins++;
        else h2h[key].losses++;
      };

      let headToHead: Record<string, { wins: number; losses: number }> = {};
      const baseState: TournamentState = {
        status: 'running',
        rounds: [],
        currentMatchId: null,
        champion: null,
        runnerUp: null,
        thirdPlace: null,
        fourthPlace: null,
        headToHead: {},
        tournamentTimeLimitMs: timeLimitMs,
        matchLog: [],
      };

      const refreshViewerData = () =>
        manager.get.tournamentData(ctx.tournamentId).then((data) => ({
          stages: data.stage,
          matches: data.match,
          matchGames: data.match_game,
          participants: data.participant,
        }));

      baseState.bracketsViewerData = await refreshViewerData();
      setTournament({ ...baseState, bracketsViewerData: baseState.bracketsViewerData });

      while (true) {
        const currentMatches = await getCurrentMatches(storage, stageId);
        const match = currentMatches.find(
          (m) => m.opponent1?.id != null && m.opponent2?.id != null && participantMap.has(m.opponent1!.id!) && participantMap.has(m.opponent2!.id!),
        ) as { id: number; opponent1?: { id: number | null }; opponent2?: { id: number | null } } | undefined;
        if (!match) break;

        const matchId = match.id;
        const pid1 = match.opponent1!.id!;
        const pid2 = match.opponent2!.id!;
        const whiteBot = participantMap.get(pid1)!;
        const blackBot = participantMap.get(pid2)!;

        setTournament((prev) => (prev ? { ...prev, currentMatchBots: { white: whiteBot, black: blackBot } } : prev));
        await new Promise((r) => setTimeout(r, 0));

        const result = await playBotMatch(whiteBot, blackBot);
        let recIdx = 0;
        for (const gr of result.gameResults) {
          // For 'draw' entries they correspond to actual games; 'time-advantage'
          // is a synthetic result with no separate game recording.
          const recording = gr.reason !== 'time-advantage' && recIdx < result.recordings.length
            ? result.recordings[recIdx++]
            : result.recordings[result.recordings.length - 1];
          baseState.matchLog!.push({
            white: whiteBot.username,
            black: blackBot.username,
            winner: gr.winner.username,
            reason: gr.reason,
            recording,
          });
        }
        setTournament((prev) => (prev ? { ...prev, matchLog: baseState.matchLog } : prev));

        trackHeadToHead(headToHead, result.winner, result.loser);

        let winnerScore = result.gameResults.filter((r) => r.winner.username === result.winner.username).length;
        let loserScore = result.gameResults.length - winnerScore;
        let matchWinner = result.winner;
        let matchLoser = result.loser;

        if (winnerScore === loserScore) {
          const timeW = result.matchTotalTimeMs[whiteBot.username] ?? 0;
          const timeB = result.matchTotalTimeMs[blackBot.username] ?? 0;
          matchWinner = timeW <= timeB ? whiteBot : blackBot;
          matchLoser = matchWinner === whiteBot ? blackBot : whiteBot;
          winnerScore = 2;
          loserScore = 1;
        }

        await updateMatchResult(
          manager,
          matchId,
          match,
          ctx.botToParticipantId.get(matchWinner.username)!,
          ctx.botToParticipantId.get(matchLoser.username)!,
          winnerScore,
          loserScore,
        );

        baseState.bracketsViewerData = await refreshViewerData();
        setTournament((prev) => (prev ? { ...prev, bracketsViewerData: baseState.bracketsViewerData, currentMatchBots: null } : prev));
      }

      const standings = await manager.get.finalStandings(stageId);
      const idToBot = (id: number) => participantMap.get(id) ?? null;
      const champion = standings[0] ? idToBot((standings[0] as { id: number }).id) : null;
      const runnerUp = standings[1] ? idToBot((standings[1] as { id: number }).id) : null;
      const thirdPlace = standings[2] ? idToBot((standings[2] as { id: number }).id) : null;
      const fourthPlace = standings[3] ? idToBot((standings[3] as { id: number }).id) : null;

      baseState.bracketsViewerData = await refreshViewerData();
      setTournament({
        ...baseState,
        bracketsViewerData: baseState.bracketsViewerData,
        status: 'finished',
        champion,
        runnerUp,
        thirdPlace,
        fourthPlace,
        headToHead,
        matchLog: baseState.matchLog,
        currentMatchId: null,
        currentMatchBots: null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Tournament failed: ${msg}`);
    } finally {
      setTournamentRunning(false);
    }
  };

  const handleStartRoundRobin = async () => {
    const useBots = bots.filter((b) => selectedTournamentBots.has(b.username));
    if (tournamentRunning || useBots.length < 2) return;
    setError(null);
    setTournamentRunning(true);

    try {
      // Build all pairings: each bot plays every other bot once as white and once as black
      const pairings: { white: BotInfo; black: BotInfo }[] = [];
      for (let i = 0; i < useBots.length; i++) {
        for (let j = 0; j < useBots.length; j++) {
          if (i !== j) pairings.push({ white: useBots[i], black: useBots[j] });
        }
      }

      // Standings map
      const standingsMap = new Map<string, RoundRobinStanding>();
      for (const bot of useBots) {
        standingsMap.set(bot.username, { bot, wins: 0, losses: 0, draws: 0, totalTimeMs: 0 });
      }

      const matchLog: TournamentState['matchLog'] = [];

      const baseState: TournamentState = {
        status: 'running',
        rounds: [],
        currentMatchId: null,
        champion: null,
        runnerUp: null,
        thirdPlace: null,
        fourthPlace: null,
        headToHead: {},
        tournamentTimeLimitMs: timeLimitMs,
        matchLog,
        roundRobinStandings: [],
        roundRobinProgress: `0 / ${pairings.length}`,
      };

      setTournament({ ...baseState });

      for (let pi = 0; pi < pairings.length; pi++) {
        const { white, black } = pairings[pi];

        setTournament((prev) =>
          prev
            ? {
                ...prev,
                currentMatchBots: { white, black },
                roundRobinProgress: `${pi} / ${pairings.length}`,
              }
            : prev,
        );
        await new Promise((r) => setTimeout(r, 0));

        const result = await playBotMatch(white, black);

        // Record every game result in the match log
        let recIdx = 0;
        for (const gr of result.gameResults) {
          const recording =
            gr.reason !== 'time-advantage' && recIdx < result.recordings.length
              ? result.recordings[recIdx++]
              : result.recordings[result.recordings.length - 1];
          matchLog.push({
            white: white.username,
            black: black.username,
            winner: gr.winner.username,
            reason: gr.reason,
            recording,
          });
        }

        // Update standings
        const ws = standingsMap.get(result.winner.username)!;
        const ls = standingsMap.get(result.loser.username)!;
        ws.wins += 1;
        ls.losses += 1;
        ws.totalTimeMs += result.matchTotalTimeMs[result.winner.username] ?? 0;
        ls.totalTimeMs += result.matchTotalTimeMs[result.loser.username] ?? 0;

        const sorted = [...standingsMap.values()].sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          return a.totalTimeMs - b.totalTimeMs;
        });

        setTournament((prev) =>
          prev
            ? {
                ...prev,
                matchLog: [...matchLog],
                roundRobinStandings: sorted,
                roundRobinProgress: `${pi + 1} / ${pairings.length}`,
                currentMatchBots: null,
              }
            : prev,
        );
      }

      const finalSorted = [...standingsMap.values()].sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return a.totalTimeMs - b.totalTimeMs;
      });

      setTournament((prev) =>
        prev
          ? {
              ...prev,
              status: 'finished',
              roundRobinStandings: finalSorted,
              roundRobinProgress: `${pairings.length} / ${pairings.length}`,
              champion: finalSorted[0]?.bot ?? null,
              runnerUp: finalSorted[1]?.bot ?? null,
              thirdPlace: finalSorted[2]?.bot ?? null,
              fourthPlace: finalSorted[3]?.bot ?? null,
              currentMatchBots: null,
            }
          : prev,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Round-robin tournament failed: ${msg}`);
    } finally {
      setTournamentRunning(false);
    }
  };

  const handleResetTournament = () => {
    if (tournamentRunning) return;
    setTournament(null);
    setTournamentRunning(false);
  };

  const handleStart = async () => {
    if (!whitePlayer || !blackPlayer || !engineRef.current) return;
    setError(null);
    setLoading(true);
    try {
      await engineRef.current.loadPlayers(whitePlayer, blackPlayer);
      setLoading(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLoading(false);
    }
  };

  const handlePlay = () => {
    engineRef.current?.play();
  };

  const handlePause = () => {
    engineRef.current?.pause();
  };

  const handleStep = () => {
    engineRef.current?.step();
  };

  const handleReset = () => {
    engineRef.current?.reset();
  };

  const handleHumanMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      if (!engineRef.current) return false;
      return engineRef.current.submitHumanMove(from, to, promotion);
    },
    [],
  );

  const gameActive = gameState.status !== 'idle' || loading;
  const tournamentActive = tournamentRunning || tournament?.status === 'running';
  const currentMatchBots = tournament?.currentMatchBots ?? null;

  // Determine board orientation: if a human is playing black (and white is a bot), flip the board
  const boardOrientation: 'white' | 'black' =
    whitePlayer?.type === 'bot' && blackPlayer?.type === 'human' ? 'black' : 'white';

  const formatDate = (isoString?: string): string => {
    if (!isoString) return 'Unknown date';
    try {
      return new Date(isoString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return 'Invalid date';
    }
  };

  const toggleBotSelection = (username: string) => {
    const newSet = new Set(selectedTournamentBots);
    if (newSet.has(username)) {
      newSet.delete(username);
    } else {
      newSet.add(username);
    }
    setSelectedTournamentBots(newSet);
  };

  const selectAllBots = () => {
    setSelectedTournamentBots(new Set(bots.map((b) => b.username)));
  };

  const clearAllBots = () => {
    setSelectedTournamentBots(new Set());
  };

  // ── Replay helpers ──────────────────────────────────────────
  const openReplay = (recording: RecordedGame) => {
    setReplayGame(recording);
    setReplayMoveIndex(recording.moves.length - 1);
  };

  const closeReplay = () => {
    setReplayGame(null);
    setReplayMoveIndex(-1);
  };

  const replayState: GameState | null = replayGame
    ? {
        status: 'finished',
        result: replayGame.result,
        fen:
          replayMoveIndex >= 0 && replayMoveIndex < replayGame.moves.length
            ? replayGame.moves[replayMoveIndex].fen
            : INITIAL_FEN,
        moves: replayGame.moves.slice(0, replayMoveIndex + 1),
        currentTurn: replayMoveIndex >= 0 ? (replayGame.moves[replayMoveIndex].color === 'w' ? 'b' : 'w') : 'w',
        whitePlayer: { type: 'bot', bot: replayGame.whiteBot },
        blackPlayer: { type: 'bot', bot: replayGame.blackBot },
        lastMoveTimeMs: 0,
        timeLimitMs: 0,
      }
    : null;

  // Sort bots by updatedAt (newest first)
  const sortedBots = [...bots].sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return dateB - dateA;
  });

  return (
    <div className="app">
      <header className="app-header">
        <h1>&#9823; Chess Competition</h1>
        <p>Select two bots, or play against a bot yourself!</p>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <BotSelector
        bots={bots}
        whitePlayer={whitePlayer}
        blackPlayer={blackPlayer}
        onWhiteChange={setWhitePlayer}
        onBlackChange={setBlackPlayer}
        onStart={handleStart}
        disabled={gameActive || tournamentActive}
        loading={loading}
        timeLimitMs={timeLimitMs}
        onTimeLimitChange={setTimeLimitMs}
      />

      <div className="tournament-panel">
        <h2>Bot Tournament</h2>
        <p className="tournament-subtitle">
          Choose double-elimination (bracket) or round-robin (everyone plays everyone).
          Uses the bot time limit above.
        </p>
        <div className="tournament-actions">
          <div className="tournament-controls">
            <h3>Select Bots for Tournament</h3>
            <div className="bot-selection-buttons">
              <button
                className="btn-secondary"
                onClick={selectAllBots}
                disabled={tournamentRunning}
              >
                Select All
              </button>
              <button
                className="btn-secondary"
                onClick={clearAllBots}
                disabled={tournamentRunning}
              >
                Clear All
              </button>
              <span className="bot-count">{selectedTournamentBots.size} selected</span>
            </div>
          </div>

          <div className="tournament-bot-list">
            {sortedBots.map((bot) => (
              <div
                key={bot.username}
                className={`tournament-bot-item ${selectedTournamentBots.has(bot.username) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  id={`bot-${bot.username}`}
                  checked={selectedTournamentBots.has(bot.username)}
                  onChange={() => toggleBotSelection(bot.username)}
                  disabled={tournamentRunning}
                />
                <label htmlFor={`bot-${bot.username}`} className="bot-item-label">
                  <img src={bot.avatar} alt={bot.username} className="bot-item-avatar" />
                  <div className="bot-item-info">
                    <span className="bot-item-name" title={bot.updatedAt || ''}>{bot.username}</span>
                    <span className="bot-item-date" title={bot.updatedAt || ''}>{formatDate(bot.updatedAt)}</span>
                  </div>
                </label>
              </div>
            ))}
          </div>

          <div className="tournament-controls">
            <label htmlFor="tournament-move-delay">Move Delay (ms):</label>
            <input
              id="tournament-move-delay"
              type="range"
              min="0"
              max="5000"
              step="100"
              value={moveDelay}
              onChange={(e) => setMoveDelay(parseInt(e.target.value, 10))}
              disabled={tournamentRunning}
            />
            <span className="delay-value">{moveDelay}ms</span>
          </div>

          <button
            className="btn-start"
            onClick={handleStartTournament}
            disabled={
              tournamentActive || selectedTournamentBots.size < 2 || loading
            }
          >
            {tournamentActive ? 'Tournament Running...' : 'Start Double Elimination Tournament'}
          </button>
          <button
            className="btn-start btn-round-robin"
            onClick={handleStartRoundRobin}
            disabled={
              tournamentActive || selectedTournamentBots.size < 2 || loading
            }
          >
            {tournamentActive ? 'Tournament Running...' : 'Start Round Robin Tournament'}
          </button>
          <button
            className="btn-secondary"
            onClick={handleResetTournament}
            disabled={tournamentActive || !tournament}
          >
            Reset Tournament
          </button>
        </div>

        {currentMatchBots && (
          <div className="tournament-status">
            Now playing: {currentMatchBots.white.username} vs {currentMatchBots.black.username}
          </div>
        )}

        <TournamentBracket tournament={tournament} />

        {/* ── Round-robin standings table ── */}
        {tournament?.roundRobinStandings && tournament.roundRobinStandings.length > 0 && (
          <div className="standings-section">
            <h3>
              Round Robin Standings
              {tournament.roundRobinProgress && (
                <span className="standings-progress"> ({tournament.roundRobinProgress} matches)</span>
              )}
            </h3>
            <table className="standings-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Bot</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {tournament.roundRobinStandings.map((s, idx) => (
                  <tr key={s.bot.username} className={idx === 0 ? 'standing-first' : idx === 1 ? 'standing-second' : idx === 2 ? 'standing-third' : ''}>
                    <td className="standing-rank">{idx + 1}</td>
                    <td className="standing-bot">
                      <img src={s.bot.avatar} alt={s.bot.username} className="standing-avatar" />
                      {s.bot.username}
                    </td>
                    <td className="standing-wins">{s.wins}</td>
                    <td className="standing-losses">{s.losses}</td>
                    <td className="standing-time">{(s.totalTimeMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(gameState.whitePlayer || loading) && (
        <div className="game-layout">
          <div className="game-left">
            <GameBoard
              gameState={gameState}
              onHumanMove={handleHumanMove}
              boardOrientation={boardOrientation}
            />
            {tournament?.matchLog && tournament.matchLog.length > 0 && (
              <div className="match-log-panel">
                <h3>Match results {replayGame && <span className="replay-badge">REPLAY</span>}</h3>

                {/* ── Replay viewer ── */}
                {replayGame && replayState && (
                  <div className="replay-viewer">
                    <div className="replay-header">
                      <span>{replayGame.whiteBot.username} vs {replayGame.blackBot.username}</span>
                      <button className="btn-secondary btn-sm" onClick={closeReplay}>Close</button>
                    </div>
                    <GameBoard gameState={replayState} boardOrientation="white" />
                    <div className="replay-controls">
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setReplayMoveIndex(-1)}
                        disabled={replayMoveIndex < 0}
                      >
                        &#9198;
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setReplayMoveIndex((i) => Math.max(-1, i - 1))}
                        disabled={replayMoveIndex < 0}
                      >
                        &#9664;
                      </button>
                      <span className="replay-move-counter">
                        {replayMoveIndex + 1} / {replayGame.moves.length}
                      </span>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setReplayMoveIndex((i) => Math.min(replayGame!.moves.length - 1, i + 1))}
                        disabled={replayMoveIndex >= replayGame.moves.length - 1}
                      >
                        &#9654;
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setReplayMoveIndex(replayGame!.moves.length - 1)}
                        disabled={replayMoveIndex >= replayGame.moves.length - 1}
                      >
                        &#9197;
                      </button>
                    </div>
                    <MoveHistory moves={replayState.moves} currentFen={replayState.fen} />
                  </div>
                )}

                <ul className="match-log-list">
                  {tournament.matchLog.map((entry, i) => (
                    <li
                      key={i}
                      className={`match-log-line clickable ${replayGame === entry.recording ? 'active-replay' : ''}`}
                      onClick={() => openReplay(entry.recording)}
                      title="Click to replay this game"
                    >
                      {entry.white} vs {entry.black}: {entry.winner} won ({formatReason(entry.reason)})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="game-right">
            {!tournamentActive ? (
              <GameControls
                gameState={gameState}
                onPlay={handlePlay}
                onPause={handlePause}
                onStep={handleStep}
                onReset={handleReset}
                moveDelay={moveDelay}
                onMoveDelayChange={setMoveDelay}
              />
            ) : (
              <div className="tournament-info">
                Tournament in progress — matches are played automatically.
              </div>
            )}
            <MoveHistory moves={gameState.moves} currentFen={gameState.fen} />
          </div>
        </div>
      )}

      {bots.length === 0 && !error && (
        <div className="loading">Loading bots...</div>
      )}
    </div>
  );
}

export default App;
