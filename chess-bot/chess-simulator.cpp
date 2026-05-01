#include "chess-simulator.h"
// disservin's lib. drop a star on his hard work!
// https://github.com/Disservin/chess-library

using namespace ChessSimulator;

const int MAX_DEPTH = 3;   // Maximum depth for general search
const int MAX_QDEPTH = 5;   // Maximum depth for quiescence search
const int MATE = 100000;    // Score value of a mate
const int INF = std::numeric_limits<int>::max();
const PST pst;

static int g_nodeCount = 0;
static std::chrono::steady_clock::time_point g_timeStart;
static int g_timeLimitMS;



int counter = 0;

/***** Main *****/

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
    if (moves.size() == 0) return "";

    // get random move
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> dist(0, moves.size() - 1);
    auto move = moves[dist(gen)];
    return chess::uci::moveToUci(move);
}

/***** Action Functions *****/

// Time measured in milliseconds
chess::Move ChessSimulator::FindBestMove(std::string fen, int timeLimit)
{
    chess::Board board(fen);
    board.setFen(fen);

    g_timeStart = std::chrono::steady_clock::now();
    g_timeLimitMS = timeLimit * 85 / 100;  // Leaves a margin of 15% of the time limit to account for OS jitter
    g_nodeCount = 0;
    chess::Move bestMove = chess::Move::NO_MOVE;
    chess::Move currBest = chess::Move::NO_MOVE;

    // Pick any legal move as a fallback
    chess::Movelist moves;
    chess::movegen::legalmoves(moves, board);

    if (moves.size() > 0) bestMove = moves[0];

    // Alpha-Beta w/ iterative deepening
    currBest = moves[0];
    //for (int currDepth = 1; currDepth <= MAX_DEPTH; currDepth++)
    for (int moveNum = 0; moveNum < moves.size(); moveNum++)
    {
        //std::cout << chess::uci::moveToUci(moves[moveNum]) << std::endl;
        counter++;
        board.makeMove(moves[moveNum]);
        int score = AlphaBeta(board, 1, -INF, INF);
        moves[moveNum].setScore(score);
        board.unmakeMove(moves[moveNum]);

        // Compare with best move

        if (score > currBest.score()) currBest = moves[moveNum];

        // Wrap up

        if (isTimeUp()) break;

        bestMove = currBest;

        if (std::abs(score) >= MATE) break; // Check if a forced checkmate was found
    }

    return bestMove;
}

// White is the maximizing player
int ChessSimulator::AlphaBeta(chess::Board board, int currDepth, int alpha, int beta)
{
    g_nodeCount++;
    
    if ((g_nodeCount & 2047) == 0)    // Check every 2048 nodes
    {
        if (isTimeUp()) return 0;
    }

    if (currDepth == MAX_DEPTH) return Quiescence(board, 1, alpha, beta);

    chess::Color currSide = board.sideToMove();     // Current player's color. 
    //std::tuple<chess::Move, int> bestMove;          // Tuple containing the best move and its score.
    int bestValue = 0;

    chess::Movelist possMoves;
    chess::movegen::legalmoves(possMoves, board);

    if (possMoves.size() == 0) {
        if (board.inCheck()) return -MATE; // checkmate
        return 0; // stalemate
    }
    
    for (chess::Move move : possMoves)
    {
        board.makeMove(move);
        int score = -1 * AlphaBeta(board, currDepth + 1, -beta, -alpha);
        board.unmakeMove(move);

        /*if (currSide == chess::Color::WHITE)
        {
            get<1>(bestMove) = std::max(get<1>(bestMove), score);
            alpha = std::max(alpha, get<1>(bestMove));
        }
        else {
            get<1>(bestMove) = std::min(get<1>(bestMove), score);
            beta = std::min(beta, get<1>(bestMove));
        }

        if (beta <= alpha) break;*/

        if (score >= beta) return beta;
        if (score > alpha) alpha = score;

        /*if (currSide == chess::Color::WHITE)
        {
            bestValue = std::max(bestValue, score);
            alpha = std::max(alpha, bestValue);
        }
        else {
            bestValue = std::min(bestValue, score);
            beta = std::min(beta, bestValue);
        }

        if (beta <= alpha) break;*/
    }

    return alpha;
}

int ChessSimulator::Quiescence(chess::Board& board, int currDepth, int alpha, int beta)
{
    int standPat = EvaluatePST(board);

    if (standPat >= beta) return beta;          // Current position is best
    if (standPat > alpha) alpha = standPat;     // Raise lower bound

    /*if (board.sideToMove() == chess::Color::WHITE)
    {
        alpha = std::max(alpha, standPat);
    }
    else {
        beta = std::min(beta, standPat);
    }*/

    // Generate captures
    chess::Movelist captures;
    chess::movegen::legalmoves<chess::movegen::MoveGenType::CAPTURE>(captures, board);

    // Order captures by MVV-LVA

    std::sort(captures.begin(), captures.end(), 
        [&](const chess::Move& a, const chess::Move& b) {
            return MVV_LVA(board, a) > MVV_LVA(board, b);
        });

    // Search captures

    for (chess::Move move : captures)
    {
        board.makeMove(move);
        int score = -1 * Quiescence(board, currDepth++, -beta, -alpha);
        board.unmakeMove(move);

        if (score >= beta) return beta;     // Beta cutoff
        if (score > alpha) alpha = score;   // Found a better capture
    }

    return alpha;
}

int ChessSimulator::MVV_LVA(const chess::Board& board, const chess::Move& move)
{
    int victim = GetPieceValue(board.at(move.to()));
    int attacker = GetPieceValue(board.at(move.from()));

    return (victim * 10) - attacker;
}

/***** Data Functions *****/

bool ChessSimulator::isTimeUp()
{
    auto timeElapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - g_timeStart).count();
    return timeElapsed >= g_timeLimitMS;
}

// Simple material evaluation
int ChessSimulator::Evaluate(chess::Board board)
{
    const int PIECE_VALUES[] = { (int)PieceValues::PAWN, (int)PieceValues::KNIGHT, (int)PieceValues::BISHOP, (int)PieceValues::ROOK, (int)PieceValues::QUEEN, (int)PieceValues::KING };
    
    int score = 0;
    
    for (int piece = static_cast<int>(chess::PieceType::underlying::PAWN); piece < static_cast<int>(chess::PieceType::underlying::NONE); piece++)
    {
        chess::PieceType::underlying pieceID = static_cast<chess::PieceType::underlying>(piece);

        score += PIECE_VALUES[piece] * board.pieces(pieceID, chess::Color::WHITE).count();
        score -= PIECE_VALUES[piece] * board.pieces(pieceID, chess::Color::BLACK).count();
    }

    return score;
}

int ChessSimulator::GetPieceValue(const chess::Piece piece)
{
    if      (piece == chess::Piece::BLACKPAWN    || piece == chess::Piece::WHITEPAWN)    return (int)PieceValues::PAWN;
    else if (piece == chess::Piece::BLACKKNIGHT  || piece == chess::Piece::WHITEKNIGHT)  return (int)PieceValues::KNIGHT;
    else if (piece == chess::Piece::BLACKBISHOP  || piece == chess::Piece::WHITEBISHOP)  return (int)PieceValues::BISHOP;
    else if (piece == chess::Piece::BLACKROOK    || piece == chess::Piece::WHITEROOK)    return (int)PieceValues::ROOK;
    else if (piece == chess::Piece::BLACKQUEEN   || piece == chess::Piece::WHITEQUEEN)   return (int)PieceValues::QUEEN;
    else if (piece == chess::Piece::BLACKKING    || piece == chess::Piece::WHITEKING)    return (int)PieceValues::KING;
    
    return 0;
}

int ChessSimulator::EvaluatePST(chess::Board board)
{
    int score = 0;

    for (int sq = 0; sq < 64; sq++)
    {
        chess::Piece piece = board.at(sq);

        if (piece == chess::Piece::NONE) continue;

        switch (piece.type())
        {
            case chess::PAWN:
                if (piece.color() == chess::Color::WHITE) score += GetPieceValue(piece) + pst.PAWN[sq];
                if (piece.color() == chess::Color::BLACK) score += GetPieceValue(piece) + pst.PAWN[pst.FLIP[sq]];
                break;
            case chess::KNIGHT:
                if (piece.color() == chess::Color::WHITE) score += GetPieceValue(piece) + pst.KNIGHT[sq];
                if (piece.color() == chess::Color::BLACK) score += GetPieceValue(piece) + pst.KNIGHT[pst.FLIP[sq]];
                break;
            case chess::BISHOP:
                if (piece.color() == chess::Color::WHITE) score += GetPieceValue(piece) + pst.BISHOP[sq];
                if (piece.color() == chess::Color::BLACK) score += GetPieceValue(piece) + pst.BISHOP[pst.FLIP[sq]];
                break;
            case chess::ROOK:
                if (piece.color() == chess::Color::WHITE) score += GetPieceValue(piece) + pst.ROOK[sq];
                if (piece.color() == chess::Color::BLACK) score += GetPieceValue(piece) + pst.ROOK[pst.FLIP[sq]];
                break;
            case chess::QUEEN:
                if (piece.color() == chess::Color::WHITE) score += GetPieceValue(piece) + pst.QUEEN[sq];
                if (piece.color() == chess::Color::BLACK) score += GetPieceValue(piece) + pst.QUEEN[pst.FLIP[sq]];
                break;
            case chess::KING:
                if (piece.color() == chess::Color::WHITE) score += GetPieceValue(piece) + pst.KING[sq];
                if (piece.color() == chess::Color::BLACK) score += GetPieceValue(piece) + pst.KING[pst.FLIP[sq]];
                break;
        }
    }

    return score;
}