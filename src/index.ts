import bolt from "@slack/bolt";
const { App } = bolt;
import env from "./utils/env.js";
import { PrismaClient, Team } from "@prisma/client";

const app = new App({
  token: env.WORKSPACE_BOT_TOKEN,
  signingSecret: env.SIGNING_SECRET,
});
const prisma = new PrismaClient();

app.event("app_mention", async ({ event, client }) => {
  client.reactions.add({
    channel: event.channel,
    timestamp: event.ts,
    name: "robot_face",
  });
});

const game = await prisma.game.findFirstOrThrow();
const id = game.id;
let number = game.number;
let lastCounter = game.lastCounter;
let upTeamMembers = game.upTeamMembers;
let downTeamMembers = game.downTeamMembers;
let upTeamWins = game.upTeamWins;
let downTeamWins = game.downTeamWins;

app.message(/^-?\d+(\s+.*)?/, async ({ message, say, client }) => {
  if (message.channel != env.CHANNEL_ID) return;
  if (!(message.subtype === undefined)) return;
  if (message.thread_ts) return;
  const team = await getTeam(message.user!);
  const num = parseInt(message.text!);
  const target = team == "UP" ? number + 1 : number - 1;
  if (message.user == lastCounter) {
    youScrewedUp(message, say, team, "You can't count twice in a row!");
    return;
  }
  if (num != target) {
    youScrewedUp(
      message,
      say,
      team,
      "That's not the right number! You're on team " +
        team +
        ", so the next number should have been " +
        target +
        "."
    );
    return;
  }
  number = target;
  lastCounter = message.user ?? null;
  await prisma.game.update({
    where: {
      id,
    },
    data: {
      number: target,
      lastCounter: message.user,
    },
  });
  if (target == 100) {
    number = 0;
    lastCounter = null;
    upTeamWins++;
    await prisma.game.update({
      where: {
        id,
      },
      data: {
        number: 0,
        lastCounter: null,
        upTeamWins: upTeamWins + 1,
      },
    });
    client.chat.postMessage({
      channel: message.channel,
      text: `And that's a win for team UP! Great job, everyone!\nThe game has been reset. The next number is 1 or -1, depending on your team.\n\nUP team wins: ${upTeamWins}\nDOWN team wins: ${downTeamWins}`,
    });
  }
  if (target == -100) {
    number = 0;
    lastCounter = null;
    downTeamWins++;
    await prisma.game.update({
      where: {
        id,
      },
      data: {
        number: 0,
        lastCounter: null,
        downTeamWins: downTeamWins + 1,
      },
    });
    client.chat.postMessage({
      channel: message.channel,
      text: `And that's a win for team DOWN! Great job, everyone!\nThe game has been reset. The next number is 1 or -1, depending on your team.\n\nUP team wins: ${upTeamWins}\nDOWN team wins: ${downTeamWins}`,
    });
  }
});

app.command("/team", async ({ command, ack, respond }) => {
  await ack();
  if (!command.text) {
    const team = await getTeam(command.user_id, false);
    await respond("You're on team " + team + "!");
  } else {
    const regexId = command.text.match(/<@([UW][A-Z0-9]+)\|/);
    if (!regexId) {
      await respond("Invalid user");
      return;
    }
    const team = await getTeam(regexId[1]);
    await respond("That person is on team " + team + "!");
  }
});

app.event("member_joined_channel", async ({ event }) => {
  getTeam(event.user);
});

const getTeam = async (uid: string, notifyOnCreate = true) => {
  const user = await prisma.user.findUnique({
    where: {
      id: uid,
    },
  });
  if (user) return user.team;
  let team: Team;
  if (upTeamMembers > downTeamMembers) {
    team = "DOWN";
  } else if (upTeamMembers < downTeamMembers) {
    team = "UP";
  } else {
    const num = Math.floor(Math.random() * 2);
    team = num == 0 ? "UP" : "DOWN";
  }
  upTeamMembers = team == "UP" ? upTeamMembers + 1 : upTeamMembers;
  downTeamMembers = team == "DOWN" ? downTeamMembers + 1 : downTeamMembers;
  await prisma.game.update({
    where: {
      id,
    },
    data: {
      upTeamMembers: team == "UP" ? upTeamMembers + 1 : upTeamMembers,
      downTeamMembers: team == "DOWN" ? downTeamMembers + 1 : downTeamMembers,
    },
  });

  await prisma.user.create({
    data: {
      id: uid,
      team,
    },
  });
  if (notifyOnCreate) {
    app.client.chat.postEphemeral({
      channel: env.CHANNEL_ID,
      user: uid,
      text: "You're on team " + team + "!",
    });
  }
  return team;
};

const youScrewedUp = async (
  message:
    | bolt.GenericMessageEvent
    | bolt.BotMessageEvent
    | bolt.FileShareMessageEvent
    | bolt.ThreadBroadcastMessageEvent,
  say: bolt.SayFn,
  team: Team,
  reason: string
) => {
  app.client.reactions.add({
    channel: message.channel,
    timestamp: message.ts,
    name: "bangbang",
  });
  const user = await prisma.user.findUnique({
    where: {
      id: message.user!,
    },
  });
  if (!user?.usedGrace) {
    say({
      text: `${reason}\nSince this is your first time screwing up, I'll let you off with a warning. Don't let it happen again!`,
    });
    await prisma.user.update({
      where: {
        id: message.user!,
      },
      data: {
        usedGrace: true,
      },
    });
    return;
  } else {
    const newNumber = team == "UP" ? number - 5 : number + 5;
    say({
      text: `${reason}\nAs punishment for your wrongdoing I'm moving the game 5 points in the other direction. Counting resumes from ${newNumber}, meaning the next number is ${
        newNumber - 1
      } or ${newNumber + 1} depending on your team.`,
    });
    number = newNumber;
    await prisma.game.update({
      where: {
        id,
      },
      data: {
        number: newNumber,
      },
    });
    return;
  }
};

app.start(3000);
