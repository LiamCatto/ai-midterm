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

	/***** Data *****/

	enum class PieceValues {
		PAWN = 100,
		KNIGHT = 320,
		BISHOP = 330,
		ROOK = 500,
		QUEEN = 900,
		KING = 99999
	};

	// Table credit : Chess programming wiki, found at https://www.chessprogramming.org/Simplified_Evaluation_Function.
	// Notes:
	//	Tables store impact on material value, not total material value. 
	//	Tables are from white's point of view, with A1 in the lower-left corner (index of 56).
	struct PST {
		const int PAWN[64]{
			  0,  0,  0,  0,  0,  0,  0,  0,
			 50, 50, 50, 50, 50, 50, 50, 50,
			 10, 10, 20, 30, 30, 20, 10, 10,
			  5,  5, 10, 25, 25, 10,  5,  5,
			  0,  0,  0, 20, 20,  0,  0,  0,
			  5, -5,-10,  0,  0,-10, -5,  5,
			  5, 10, 10,-20,-20, 10, 10,  5,
			  0,  0,  0,  0,  0,  0,  0,  0
		};
		const int KNIGHT[64] {	
			-50,-40,-30,-30,-30,-30,-40,-50,
			-40,-20,  0,  0,  0,  0,-20,-40,
			-30,  0, 10, 15, 15, 10,  0,-30,
			-30,  5, 15, 20, 20, 15,  5,-30,
			-30,  0, 15, 20, 20, 15,  0,-30,
			-30,  5, 10, 15, 15, 10,  5,-30,
			-40,-20,  0,  5,  5,  0,-20,-40,
			-50,-40,-30,-30,-30,-30,-40,-50,
		};
		const int BISHOP[64]{
			-20,-10,-10,-10,-10,-10,-10,-20,
			-10,  0,  0,  0,  0,  0,  0,-10,
			-10,  0,  5, 10, 10,  5,  0,-10,
			-10,  5,  5, 10, 10,  5,  5,-10,
			-10,  0, 10, 10, 10, 10,  0,-10,
			-10, 10, 10, 10, 10, 10, 10,-10,
			-10,  5,  0,  0,  0,  0,  5,-10,
			-20,-10,-10,-10,-10,-10,-10,-20,
		};
		const int ROOK[64]{
			  0,  0,  0,  0,  0,  0,  0,  0,
			  5, 10, 10, 10, 10, 10, 10,  5,
			 -5,  0,  0,  0,  0,  0,  0, -5,
			 -5,  0,  0,  0,  0,  0,  0, -5,
			 -5,  0,  0,  0,  0,  0,  0, -5,
			 -5,  0,  0,  0,  0,  0,  0, -5,
			 -5,  0,  0,  0,  0,  0,  0, -5,
			  0,  0,  0,  5,  5,  0,  0,  0
		};
		const int QUEEN[64]{
			-20,-10,-10, -5, -5,-10,-10,-20,
			-10,  0,  0,  0,  0,  0,  0,-10,
			-10,  0,  5,  5,  5,  5,  0,-10,
			 -5,  0,  5,  5,  5,  5,  0, -5,
			  0,  0,  5,  5,  5,  5,  0, -5,
			-10,  5,  5,  5,  5,  5,  0,-10,
			-10,  0,  5,  0,  0,  0,  0,-10,
			-20,-10,-10, -5, -5,-10,-10,-20
		};
		const int KING[64]{
			-30,-40,-40,-50,-50,-40,-40,-30,
			-30,-40,-40,-50,-50,-40,-40,-30,
			-30,-40,-40,-50,-50,-40,-40,-30,
			-30,-40,-40,-50,-50,-40,-40,-30,
			-20,-30,-30,-40,-40,-30,-30,-20,
			-10,-20,-20,-20,-20,-20,-20,-10,
			 20, 20,  0,  0,  0,  0, 20, 20,
			 20, 30, 10,  0,  0, 10, 30, 20
		};
		const int FLIP[64]{		// Table credit: Rustic chess engine documentation, found at https://rustic-chess.org/evaluation/psqt.html.
			 56, 57, 58, 59, 60, 61, 62, 63,
			 48, 49, 50, 51, 52, 53, 54, 55,
			 40, 41, 42, 43, 44, 45, 46, 47,
			 32, 33, 34, 35, 36, 37, 38, 39,
			 24, 25, 26, 27, 28, 29, 30, 31,
			 16, 17, 18, 19, 20, 21, 22, 23,
			  8,  9, 10, 11, 12, 13, 14, 15,
			  0,  1,  2,  3,  4,  5,  6,  7,
		};
	};

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

	int EvaluatePST(chess::Board board);

} // namespace ChessSimulator
