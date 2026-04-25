#pragma once
#include "chess.hpp"
#include <string>
#include <random>
#include <chrono>
#include <limits>
#include <cmath>

namespace ChessSimulator {
	/**
	 * @brief Move a piece on the board
	 *
	 * @param fen The board as FEN
	 * @param timeLimitMs The time limit for the move in milliseconds
	 * @return std::string The move as UCI
	 */
	std::string Move(std::string fen, int timeLimitMs = 10000);

	/***** Action Functions *****/

	// Time measured in milliseconds
	chess::Move FindBestMove(std::string fen, int timeLimit);

	// White is the maximizing player
	int AlphaBeta(chess::Board board, int currDepth, int alpha, int beta);

	int Quiescence(chess::Board& board, int currDepth, int alpha, int beta);

	int MVV_LVA(const chess::Board& board, const chess::Move& move);

	/***** Data Functions *****/

	bool isTimeUp();

	// Simple material evaluation
	int Evaluate(chess::Board board);

	int GetPieceValue(chess::Piece piece);

} // namespace ChessSimulator
