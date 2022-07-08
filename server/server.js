const express = require('express');
const logger = require('morgan');
const cors = require('cors');
const app = express();
const server = require('http').createServer(app);

app.use(logger('dev'));
app.use(cors());
app.get("/", (_, res) => {
  res.redirect('https://etuong.github.io/pictionary.io');
});
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
const port = process.env.PORT || 8081;

server.listen(port, () => {
  console.log(`Server is listening on port: ${port}`);
});

const io = require('socket.io')(server, {
  cors: {
    origin: ["http://localhost:8080"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 30000
});

const Player = require("./Player");
const GameRoom = require("./GameRoom");
const gameRooms = new Map();
const shuffleArray = require("./Utility.js");

io.on('connection', (socket) => {
  socket.emit('connected');

  socket.on('create_room', data => {
    const roomId = data.password.toUpperCase();

    if (gameRooms.has(roomId)) {
      socket.emit('room_existed')
      console.log(`${data.name} tries to create room ${roomId} but room exists already`);
    } else {
      const newGameRoom = new GameRoom(roomId);

      const newPlayer = new Player(data.name, socket.id, roomId);

      newGameRoom.addPlayerToRoom(newPlayer);

      socket.join(roomId);

      socket.emit('show_lobby');

      socket.emit('update_player', newPlayer);

      socket.emit('update_preparation', {
        players: newGameRoom.players,
        isGameReady: newGameRoom.isGameReady()
      });

      gameRooms.set(roomId, newGameRoom);

      console.log(`${data.name} has created a new game with password ${data.password} in room ${roomId}`);
    }
  });

  socket.on('join_room', data => {
    const roomId = data.password.toUpperCase();
    const gameRoom = gameRooms.get(roomId);

    if (!gameRoom) {
      socket.emit('room_does_not_exist')
      console.log(`${data.name} tries to join room ${roomId} but room does not exist`);
    } else if (gameRoom.players.length == 10) {
      socket.emit("room_full");
      console.log(`${data.name} tries to join room ${roomId} but room is full`);
    } else if (gameRoom.isDuplicatePlayerName(data.name)) {
      socket.emit("player_name_exist");
    } else if (gameRoom.isGameInSession) {
      socket.emit("game_in_session");
      console.log(`${data.name} tries to join room ${roomId} but game is in session`);
    } else {
      const newPlayer = new Player(data.name, socket.id, roomId);

      gameRoom.addPlayerToRoom(newPlayer);

      socket.join(roomId);

      socket.emit('show_lobby');

      socket.emit('update_player', newPlayer);

      io.sockets.in(roomId).emit('update_preparation', {
        players: gameRoom.players,
        isGameReady: gameRoom.isGameReady()
      });


      console.log(`${data.name} has joined room ${roomId}`);
    }
  });

  socket.on('player_ready', player => {
    const gameRoom = gameRooms.get(player.roomId);
    const selected_player = gameRoom.getPlayerById(player.id);
    selected_player.ready = true;

    socket.emit('update_player', selected_player);

    io.sockets.in(player.roomId).emit('update_preparation', {
      players: gameRoom.players,
      isGameReady: gameRoom.isGameReady()
    });

    console.log(`${player.name} is ready to play in room ${player.roomId}!`);
  });

  socket.on('game_ready', roomId => {
    const gameRoom = gameRooms.get(roomId);
    gameRoom.startGame();
    io.sockets.in(roomId).emit('game_start');
    setTimeout(() => io.sockets.in(roomId).emit('update_playground', {
      currentBlackCard: gameRoom.currentBlackCard,
      currentCzar: gameRoom.currentCzar,
      czarMessage: "Please wait for other players to select a white card",
    }), 80);

    io.sockets.in(roomId).emit('update_game_status', gameRoom.players);

    console.log(`Room ${roomId} is playing!`);
  });

  socket.on("white_card_submission", data => {
    const roomId = data.roomId;
    const gameRoom = gameRooms.get(roomId);
    const submitted_player = gameRoom.getPlayerById(data.playerId);
    const { playerSelections, players } = gameRoom;

    console.log(`${submitted_player.name} submitted: ${data.selection}`);

    submitted_player.cards.splice(submitted_player.cards.indexOf(data.selection), 1);

    playerSelections.push({
      name: submitted_player.name,
      id: submitted_player.id,
      selection: data.selection,
    });

    submitted_player.cardSelected = true;
    io.sockets.in(roomId).emit('update_game_status', gameRoom.players);

    if (playerSelections.length === players.length - 1) {
      const sanitizedSelections = playerSelections.map(el => el.selection);
      shuffleArray(sanitizedSelections);
      console.log(`Sending cards to Czar: ${sanitizedSelections}`)
      io.sockets.in(roomId).emit('czar_chooses', {
        playerSelections: sanitizedSelections,
      });
    }
  })

  socket.on("slide_player_selections", data => {
    io.sockets.in(data.roomId).emit("slide_player_selections", data);
  })

  socket.on("czar_selection", data => {
    const roomId = data.roomId;
    const gameRoom = gameRooms.get(roomId);
    const { playerSelections, players } = gameRoom;
    let winner = {};

    console.log(`Czar ${gameRoom.currentCzar} chose "${data.czarSelection}"`);

    for (let item of playerSelections) {
      if (item.selection === data.czarSelection) {
        winner.id = item.id;
        winner.name = item.name;
        winner.white = data.czarSelection;
        winner.black = gameRoom.currentBlackCard;
        let winningPlayer = gameRoom.getPlayerById(item.id);
        if (winningPlayer) {
          winningPlayer.winningCards.push(winner)
        }
        break;
      }
    }

    io.sockets.in(roomId).emit('winner_announced', winner);

    gameRoom.resetRound();

    io.sockets.in(roomId).emit('update_playground', {
      currentBlackCard: gameRoom.currentBlackCard,
      currentCzar: gameRoom.currentCzar,
      czarMessage: "Please wait for other players to select a white card",
    });

    io.sockets.in(roomId).emit('update_game_status', gameRoom.players);

  })

  socket.on('disconnect', () => {
    gameRooms.forEach((gameRoom, roomId) => {
      let players = gameRoom.players;
      for (let player of players) {
        if (player.id === socket.id) {
          socket.leave(roomId);
          io.sockets.in(roomId).emit('player_disconnect', player.name);
          console.log(`${player.name} just left room ${roomId}!`);

          const number_of_current_players = gameRoom.removePlayerFromRoom(player);

          if (gameRoom.isGameInSession && number_of_current_players < 3) {
            gameRooms.delete(roomId);
            io.sockets.in(roomId).emit("show_home");
            console.log(`Deleting room ${roomId} because not enough players`);
          } else {
            io.sockets.in(roomId).emit('update_preparation', {
              players: gameRoom.players,
              isGameReady: gameRoom.isGameReady()
            });
          }

          break;
        }
      }
    })
  });

  socket.on('mock', () => {
    const { player1, gameRoom, roomId } = require("./Mock");
    gameRooms.set(roomId, gameRoom);

    socket.join(roomId);
    socket.emit('game_start');
    socket.emit('update_player', player1);

    setTimeout(() => socket.emit('update_playground', {
      currentBlackCard: gameRoom.currentBlackCard,
      currentCzar: "",//gameRoom.currentCzar, // Leave blank to test the Czar view
      czarMessage: "Please wait for other players to select a white card",
    }), 400);

  });
});

process.on("exit", function (code) {
  server.close();
  console.log("Server exit", code);
});