#include "chess-simulator.h"
// disservin's lib. drop a star on his hard work!
// https://github.com/Disservin/chess-library
#include "chess.hpp"
#include <random>
#include <chrono>
#include <limits>

using namespace ChessSimulator;

const int MAX_DEPTH = 64;
const int MATE = 100000;
const int INF = std::numeric_limits<int>::infinity();

std::string ChessSimulator::Move(std::string fen, int timeLimitMs) {
  // create your board based on the board string following the FEN notation
  // search for the best move using minimax / monte carlo tree search /
  // alpha-beta pruning / ... try to use nice heuristics to speed up the search
  // and have better results return the best move in UCI notation you will gain
  // extra points if you create your own board/move representation instead of
  // using the one provided by the library

    return chess::uci::moveToUci(FindBestMove(fen, timeLimitMs));

  // here goes a random movement
  chess::Board board(fen);
  chess::Movelist moves;
  chess::movegen::legalmoves(moves, board);
  if(moves.size() == 0)
    return "";

  // get random move
  std::random_device rd;
  std::mt19937 gen(rd());
  std::uniform_int_distribution<> dist(0, moves.size() - 1);
  auto move = moves[dist(gen)];
  return chess::uci::moveToUci(move);
}

// Action Functions

// Time measured in milliseconds
chess::Move FindBestMove(std::string fen, int timeLimit)
{
    chess::Board board(fen);
    board.setFen(fen);

    int timeBudget = timeLimit * 85 / 100;  // Leaves a margin of 15% of the time limit to account for OS jitter
    auto startTime = std::chrono::steady_clock::now();
    chess::Move bestMove = chess::Move::NO_MOVE;

    for (int currDepth = 1; currDepth <= MAX_DEPTH; currDepth++)
    {
        chess::Move currBest;
        int score = AlphaBeta(board, currDepth, -INF, INF);

        if (isTimeUp(startTime, timeBudget)) break;

        bestMove = currBest;

        if (std::abs(score) >= MATE - MAX_DEPTH) break; // Check if a forced checkmate was found
    }
    
    return bestMove;
}

// White is the maximizing player
// TODO: Does not float up the best move with its score
// TODO: Figure out in what conditions to evaluate
int AlphaBeta(chess::Board board, int currDepth, int alpha, int beta)
{
    //if (depth == 0 || depth == MAX_DEPTH) board.  // Look into when evaluation occurs

    chess::Color currSide = board.sideToMove();     // Current player's color. 
    std::tuple<chess::Move, int> bestMove;          // Tuple containing the best move and its score.

    chess::Movelist possMoves;
    /*
    Generate legal moves for each position using chess::movegen, store in possMoves.
    */

    for (chess::Move move : possMoves)
    {
        board.makeMove(move);

        int score = AlphaBeta(board, currDepth - 1, alpha, beta);

        if (currSide == chess::Color::WHITE)
        {
            get<1>(bestMove) = std::max(get<1>(bestMove), score);
            alpha = std::max(alpha, get<1>(bestMove));
        }
        else {
            get<1>(bestMove) = std::min(get<1>(bestMove), score);
            beta = std::min(beta, get<1>(bestMove));
        }

        if (beta <= alpha) break;
    }
}

// Data Functions

bool isTimeUp(std::chrono::steady_clock::time_point start, int limit)
{
    auto timeElapsed = std::chrono::duration_cast<std::chrono::milliseconds>( std::chrono::steady_clock::now() - start ).count();
    return timeElapsed >= limit;
}