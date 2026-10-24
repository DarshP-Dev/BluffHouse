import {validAmount,type Command,type RpsChoice,type DuelInvite} from '@bluff-house/shared';
import {available,reserve,release,commit,settle} from './ledger.js';
import {requireRule,type Room,type Player,type EngineOptions,type DuelState} from './state.js';
import {createConnect4,moveConnect4} from './connect4.js';
import {createChess,moveChess,chessTimeout,restoreChess} from './chess.js';
import {assertBallots,failBallot,overthrowDeadline,settleLastStand} from './overthrow.js';
import {validateBountyDefense,acceptBountyDefense,settleBountyDefense} from './bounties.js';

const ADMISSION_MS=20000,INVITE_MS=8000,PLAY_MS=60000,THROW_MS=8000,SUMMARY_MS=2000,SOCIAL_MS=90000;
const stakeKey=(id:string,playerId:string)=>`${id}:${playerId}:duel`;
const participants=(r:Room)=>r.players.filter(p=>p.participating&&p.connected&&!p.departed);
const gameName=(d:Pick<DuelState,'game'>)=>({RPS:'Rock Paper Scissors',COIN:'Coin Flip',CONNECT4:'Connect 4',CHESS:'Bullet Chess'}[d.game]);
function event(r:Room,e:EngineOptions,text:string,at:number,playerId?:string){
  r.events.push({id:e.id(),kind:'duel',text,at,playerId,revision:r.revision+1});r.events=r.events.slice(-60);
}
function player(r:Room,id:string){const p=r.players.find(p=>p.id===id);requireRule(p,'PLAYER_MISSING');return p;}
export function refreshSocialDeadline(r:Room){
  const social=r.party!.social!;
  r.deadline=Math.min(social.admissionDeadline,social.hardDeadline,...social.invites.filter(i=>i.status==='pending').map(i=>i.deadline),...(social.ballot?.status==='open'?[social.ballot.deadline]:[]));
}
function cancelInvite(r:Room,invite:DuelInvite,status:'expired'|'rejected'|'cancelled'){
  if(invite.status!=='pending')return;
  release(player(r,invite.inviterId).account,stakeKey(invite.id,invite.inviterId));invite.status=status;
}
export function cancelSocialInvites(r:Room){for(const invite of r.party!.social!.invites)cancelInvite(r,invite,'cancelled');}

/** An independent admission slot follows a settled, non-final Party round. */
export function openSocial(r:Room,e:EngineOptions,now:number){
  requireRule(r.mode==='PARTY'&&r.party,'PARTY_REQUIRED');requireRule(!r.party.social,'SOCIAL_ALREADY_OPEN');
  requireRule(!r.terminationConfirmed&&participants(r).length>=2,'NOT_ENOUGH_PLAYERS');
  r.party.socialRound=r.round;
  r.party.social={id:e.id(),slotId:e.id(),openedAt:now,slot:1,slotOpenedAt:now,admissionDeadline:now+ADMISSION_MS,hardDeadline:now+(r.roundLimit===6?SOCIAL_MS*2:SOCIAL_MS),invites:[],duel:null,ballot:null};
  r.phase='SOCIAL';r.deadline=now+ADMISSION_MS;r.activePlayerId=undefined;r.decisionId=undefined;
  event(r,e,'Social interval · Invite a player to a funded duel. The defender chooses the game.',now);
}

/** -1 means a tied throw; a single missing choice forfeits that throw. */
export function rpsWinner(first:RpsChoice|null,second:RpsChoice|null):0|1|-1{
  if(first===second)return -1;
  if(!first)return 1;if(!second)return 0;
  return first==='ROCK'&&second==='SCISSORS'||first==='PAPER'&&second==='ROCK'||first==='SCISSORS'&&second==='PAPER'?0:1;
}

function finishDuel(r:Room,d:DuelState,e:EngineOptions,now:number,winnerId:string|null,reason:string){
  if(d.status==='settled')return;
  if(d.chess){const clock=d.chess;clock.remainingMs[clock.turnId]=Math.max(0,clock.remainingMs[clock.turnId]-Math.max(0,now-clock.clockStartedAt));clock.clockStartedAt=now;}
  const first=player(r,d.inviterId),second=player(r,d.defenderId);
  if(d.purpose!=='LAST_STAND')for(const p of [first,second])settle(p.account,stakeKey(d.id,p.id),winnerId?(p.id===winnerId?d.amount*2:0):d.amount);
  d.status='settled';d.winnerId=winnerId;d.reason=reason;d.throwId=undefined;d.choices={};
  d.deadline=Math.min(now,d.hardDeadline);
  if(d.purpose==='BOUNTY')settleBountyDefense(r,d,e,now,winnerId);
  r.party!.duelHistory.push(structuredClone(d));
  r.phase='DUEL_RESULT';r.deadline=Math.min(now+SUMMARY_MS,r.party!.social!.hardDeadline);
  if(d.purpose==='LAST_STAND')settleLastStand(r,e,now,winnerId,reason);
  else event(r,e,winnerId?`${player(r,winnerId).name} wins the ${d.amount*2}-chip ${gameName(d)} pot. ${reason}`:`The duel is a draw. Both ${d.amount}-chip stakes are returned. ${reason}`,now,winnerId??undefined);
}
function scoreWinner(d:DuelState){
  const a=d.scores[d.inviterId],b=d.scores[d.defenderId];return a===b?null:a>b?d.inviterId:d.defenderId;
}
function finishThrow(r:Room,d:DuelState,e:EngineOptions,now:number){
  const a=d.choices[d.inviterId]??null,b=d.choices[d.defenderId]??null;
  const result=rpsWinner(a,b);
  const winnerId=result===-1?null:result===0?d.inviterId:d.defenderId;
  if(winnerId)d.scores[winnerId]++;
  d.throws.push({number:d.throwNumber,choices:{[d.inviterId]:a,[d.defenderId]:b},winnerId});d.choices={};
  event(r,e,`RPS throw ${d.throwNumber}: ${winnerId?`${player(r,winnerId).name} wins`:'draw'}${!a||!b?' (missing choices forfeit the throw)':''}.`,now,winnerId??undefined);
  if(d.scores[d.inviterId]>=3||d.scores[d.defenderId]>=3||d.throwNumber>=5||now>=d.hardDeadline){
    finishDuel(r,d,e,now,scoreWinner(d),now>=d.hardDeadline?'Play deadline reached.':d.throwNumber>=5?'Five throws completed.':'First to three wins.');return;
  }
  d.throwNumber++;d.throwId=e.id();d.deadline=Math.min(now+THROW_MS,d.hardDeadline);r.deadline=d.deadline;
}

/** Both funded duels and crown-only Last Stands use the same rules and clocks. */
export function startDuel(r:Room,e:EngineOptions,now:number,setup:Pick<DuelState,'id'|'game'|'inviterId'|'defenderId'|'amount'|'purpose'|'ballotId'|'bountyId'>,coinSide?:'HEADS'|'TAILS'){
  const social=r.party!.social!,{game,inviterId,defenderId}=setup;
  requireRule(!social.duel,'DUEL_ALREADY_STARTED');
  const duel:DuelState={...setup,socialId:social.id,slot:social.slot,status:'playing',startedAt:now,hardDeadline:now+PLAY_MS,deadline:now+THROW_MS,throwNumber:game==='RPS'?1:0,scores:{[inviterId]:0,[defenderId]:0},choices:{},throws:[],winnerId:null};
  social.duel=duel;r.phase='DUEL';r.deadline=duel.deadline;
  if(duel.purpose==='LAST_STAND')event(r,e,`The House chooses ${gameName(duel)} for the zero-stake Last Stand.`,now,defenderId);
  if(game==='RPS')duel.throwId=e.id();
  else if(game==='COIN'){
    requireRule(coinSide==='HEADS'||coinSide==='TAILS','INVALID_COIN_SIDE');
    duel.coinSide=coinSide;const index=e.randomIndex(2);requireRule(index===0||index===1,'INVALID_RANDOM_INDEX');
    duel.coinResult=index===0?'HEADS':'TAILS';finishDuel(r,duel,e,now,duel.coinResult===duel.coinSide?defenderId:inviterId,`The coin landed ${duel.coinResult.toLowerCase()}.`);
  }else{
    const index=e.randomIndex(2);requireRule(index===0||index===1,'INVALID_RANDOM_INDEX');
    const first=index===0?inviterId:defenderId,second=index===0?defenderId:inviterId;
    if(game==='CONNECT4'){
      duel.connect4=createConnect4(first,second,e);duel.hardDeadline=now+45000;duel.deadline=Math.min(now+THROW_MS,duel.hardDeadline);
    }else{
      const chess=createChess(first,second,e,now);duel.chess=chess.view;duel.chessPgn=chess.pgn;duel.deadline=Math.min(now+30000,duel.hardDeadline);
    }
    r.deadline=duel.deadline;
  }
}

/** Shared admission/funding for ordinary invitations and matched bounty defenses. */
export function inviteDuel(r:Room,p:Player,defenderId:unknown,amount:unknown,e:EngineOptions,now:number,meta:Pick<DuelInvite,'purpose'|'bountyId'>={}){
  const social=r.party?.social;requireRule(social&&r.phase==='SOCIAL'&&!social.duel&&now<social.admissionDeadline,'ADMISSION_CLOSED');
  requireRule(!r.terminationConfirmed&&participants(r).length>=2,'NOT_ENOUGH_PLAYERS');
  requireRule(!social.invites.some(i=>i.inviterId===p.id&&i.status==='pending'),'INVITE_PENDING','Your outgoing invitation is still pending.');
  requireRule(social.invites.length<64,'INVITE_LIMIT');
  requireRule(typeof defenderId==='string'&&defenderId!==p.id,'INVALID_DEFENDER');
  const defender=participants(r).find(candidate=>candidate.id===defenderId);requireRule(defender,'DEFENDER_UNAVAILABLE');
  requireRule(validAmount(amount),'INVALID_AMOUNT','Choose 50–250 chips in steps of 50.');
  requireRule(available(p.account)>=amount,'INSUFFICIENT_AVAILABLE_CHIPS');
  const id=e.id();reserve(p.account,stakeKey(id,p.id),amount);
  social.invites.push({id,inviterId:p.id,defenderId,amount,deadline:Math.min(now+INVITE_MS,social.admissionDeadline),status:'pending',slot:social.slot,...meta});
  event(r,e,`${p.name} invites ${defender.name} to a ${amount}-chip ${meta.purpose==='BOUNTY'?'bounty defense':'duel'}.`,now,p.id);refreshSocialDeadline(r);
}

export function duelCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  const social=r.party?.social;requireRule(r.mode==='PARTY'&&social,'SOCIAL_CLOSED');
  requireRule(c.socialId===social.id,'STALE_SOCIAL');
  requireRule(p.participating&&p.connected&&!p.departed,'NOT_PARTICIPATING');
  if(c.type==='duel:invite'||c.type==='duel:accept'||c.type==='duel:reject'){
    requireRule(c.socialSlotId===social.slotId,'STALE_SOCIAL_SLOT','This social admission slot has changed.');
    requireRule(r.phase==='SOCIAL'&&!social.duel&&now<social.admissionDeadline,'ADMISSION_CLOSED');
    if(c.type==='duel:invite'){
      inviteDuel(r,p,c.payload?.defenderId,c.payload?.amount,e,now);return;
    }
    const invite=social.invites.find(i=>i.id===c.inviteId);requireRule(invite&&invite.status==='pending'&&now<invite.deadline,'INVITE_CLOSED');
    requireRule(invite.defenderId===p.id,'NOT_DEFENDER');
    if(c.type==='duel:reject'){cancelInvite(r,invite,'rejected');event(r,e,`${p.name} declines the duel. Reserved chips are released.`,now,p.id);refreshSocialDeadline(r);return;}
    requireRule(!r.terminationConfirmed&&participants(r).length>=2,'NOT_ENOUGH_PLAYERS');
    requireRule(now+PLAY_MS+SUMMARY_MS<=social.hardDeadline,'INSUFFICIENT_SOCIAL_TIME');
    const inviter=participants(r).find(candidate=>candidate.id===invite.inviterId);requireRule(inviter,'INVITER_UNAVAILABLE');
    const game=c.payload?.game;requireRule(game==='RPS'||game==='COIN'||game==='CONNECT4'||game==='CHESS','INVALID_GAME');
    const coinSide=c.payload?.coinSide;requireRule(game!=='COIN'||coinSide==='HEADS'||coinSide==='TAILS','INVALID_COIN_SIDE');
    validateBountyDefense(r,invite);
    // The room commits this candidate atomically: conflicting outgoing offers no
    // longer reserve funds once this acceptance owns the only contest slot.
    for(const other of social.invites)if(other!==invite)cancelInvite(r,other,'cancelled');
    requireRule(available(p.account)>=invite.amount,'INSUFFICIENT_AVAILABLE_CHIPS');
    reserve(p.account,stakeKey(invite.id,p.id),invite.amount);
    commit(inviter.account,stakeKey(invite.id,inviter.id));commit(p.account,stakeKey(invite.id,p.id));invite.status='accepted';
    acceptBountyDefense(r,invite);
    failBallot(r,e,now,'The overthrow ballot closed because a funded duel was accepted.');
    event(r,e,`${p.name} accepts ${inviter.name}'s duel and chooses ${gameName({game})}. Both stakes are committed.`,now,p.id);
    startDuel(r,e,now,{id:invite.id,game,inviterId:inviter.id,defenderId:p.id,amount:invite.amount,purpose:invite.purpose,bountyId:invite.bountyId},coinSide as 'HEADS'|'TAILS'|undefined);
    return;
  }
  const duel=social.duel;requireRule(r.phase==='DUEL'&&duel?.status==='playing','DUEL_CLOSED');requireRule(c.duelId===duel.id,'STALE_DUEL');
  requireRule(p.id===duel.inviterId||p.id===duel.defenderId,'NOT_DUEL_PLAYER');
  if(c.type==='duel:resign'){finishDuel(r,duel,e,now,p.id===duel.inviterId?duel.defenderId:duel.inviterId,`${p.name} resigned.`);return;}
  if(c.type==='duel:move'){
    requireRule(duel.game==='CONNECT4'||duel.game==='CHESS','UNAVAILABLE_ACTION');
    requireRule(now<duel.deadline&&now<duel.hardDeadline,'MOVE_DEADLINE');
    requireRule(c.moveId===(duel.connect4?.moveId??duel.chess?.moveId),'STALE_MOVE');
    const other=p.id===duel.inviterId?duel.defenderId:duel.inviterId;
    const outcome=duel.game==='CONNECT4'?moveConnect4(duel.connect4!,p.id,c.payload?.column,other,e):moveChess(duel,p.id,c.payload,e,now);
    if(outcome)finishDuel(r,duel,e,now,outcome.winnerId,outcome.reason);
    else {if(duel.game==='CONNECT4')duel.deadline=Math.min(now+THROW_MS,duel.hardDeadline);r.deadline=duel.deadline;}
    return;
  }
  requireRule(c.type==='duel:choose'&&duel.game==='RPS','UNAVAILABLE_ACTION');requireRule(c.throwId===duel.throwId,'STALE_THROW');
  requireRule(now<duel.deadline&&!Object.hasOwn(duel.choices,p.id),'CHOICE_LOCKED');
  const choice=c.payload?.choice;requireRule(choice==='ROCK'||choice==='PAPER'||choice==='SCISSORS','INVALID_CHOICE');
  duel.choices[p.id]=choice;
  if(Object.hasOwn(duel.choices,duel.inviterId)&&Object.hasOwn(duel.choices,duel.defenderId))finishThrow(r,duel,e,now);
}

/** Presence changes can release pending offers, never accepted escrow. */
export function cancelPlayerInvites(r:Room,playerId:string,e:EngineOptions,now:number){
  const social=r.party?.social;if(!social)return;
  let cancelled=false;
  for(const invite of social.invites)if(invite.status==='pending'&&(invite.inviterId===playerId||invite.defenderId===playerId)){cancelInvite(r,invite,'cancelled');cancelled=true;}
  if(cancelled)event(r,e,'Pending duel invitations involving an unavailable player were cancelled; reservations were released.',now,playerId);
  if(r.phase==='SOCIAL')refreshSocialDeadline(r);
}

/** Returns true only after the current bounded interval has no live obligation. */
export function socialDeadline(r:Room,e:EngineOptions,at:number):boolean{
  const social=r.party?.social;requireRule(social,'SOCIAL_CLOSED');
  if(r.phase==='DUEL_RESULT'){
    if(r.roundLimit===6&&social.slot===1&&!r.terminationConfirmed&&participants(r).length>=2&&social.hardDeadline-at>=SOCIAL_MS){
      social.slot=2;social.slotId=e.id();social.slotOpenedAt=at;social.admissionDeadline=at+ADMISSION_MS;social.duel=null;
      r.phase='SOCIAL';r.deadline=social.admissionDeadline;
      event(r,e,'Social interval · Second and final contest slot. Its deadlines share the original interval budget.',at);return false;
    }
    closeSocial(r);return true;
  }
  if(r.phase==='LAST_STAND_CHOICE'){overthrowDeadline(r,e,at);return false;}
  if(r.phase==='DUEL'){
    const duel=social.duel;requireRule(duel?.status==='playing','DUEL_CLOSED');
    if(duel.game==='CONNECT4'){
      const active=duel.connect4!.activePlayerId;
      finishDuel(r,duel,e,at,at>=duel.hardDeadline?null:active===duel.inviterId?duel.defenderId:duel.inviterId,at>=duel.hardDeadline?'The unfinished board reached its 45-second limit.':'The player to move ran out of time.');
    }else if(duel.game==='CHESS'){
      const outcome=chessTimeout(duel,at);finishDuel(r,duel,e,at,outcome.winnerId,outcome.reason);
    }else finishThrow(r,duel,e,at);
    return false;
  }
  requireRule(r.phase==='SOCIAL','INVALID_PHASE_DEADLINE');
  overthrowDeadline(r,e,at);
  if(r.phase!=='SOCIAL')return false;
  for(const invite of social.invites)if(invite.status==='pending'&&invite.deadline<=at)cancelInvite(r,invite,'expired');
  if(at>=social.admissionDeadline||at>=social.hardDeadline){closeSocial(r);return true;}
  refreshSocialDeadline(r);return false;
}

export function closeSocial(r:Room){
  const social=r.party?.social;if(!social)return;
  requireRule(!social.duel||social.duel.status==='settled','LIVE_DUEL_OBLIGATION');
  requireRule(!social.ballot||social.ballot.status==='open'||social.ballot.status==='failed'||social.ballot.status==='settled','LIVE_LAST_STAND_OBLIGATION');
  if(social.ballot?.status==='open'){
    social.ballot.status='failed';social.ballot.reason='The social interval closed before an overthrow was accepted.';
    if(!r.party!.overthrowHistory.some(b=>b.id===social.ballot!.id))r.party!.overthrowHistory.push(structuredClone(social.ballot));
  }
  for(const invite of social.invites)cancelInvite(r,invite,'cancelled');
  r.party!.social=null;r.deadline=null;
}

/** Match ledger conservation cannot alone detect orphaned or mismatched stakes. */
export function assertDuels(r:Room){
  const party=r.party;if(!party)return;
  assertBallots(r);
  const social=party.social;
  for(const invite of social?.invites??[]){
    requireRule(invite.purpose===undefined||invite.purpose==='BOUNTY','DUEL_INVITE_PURPOSE_INVARIANT');
    requireRule(invite.inviterId!==invite.defenderId&&validAmount(invite.amount),'INVALID_DUEL_INVITE');
    const inviter=player(r,invite.inviterId),key=stakeKey(invite.id,inviter.id);
    const slot=invite.slot??1,openedAt=slot===1?social!.openedAt:social!.slotOpenedAt;
    requireRule((slot===1||slot===2&&social!.slot===2)&&invite.deadline<=openedAt+ADMISSION_MS&&invite.deadline>openedAt,'INVITE_DEADLINE_INVARIANT');
    if(invite.purpose==='BOUNTY')requireRule(invite.amount===50&&typeof invite.bountyId==='string'&&party.bounties.some(b=>b.id===invite.bountyId&&b.targetId===invite.defenderId),'BOUNTY_INVITE_INVARIANT');
    if(invite.status==='pending')requireRule(inviter.account.reservations[key]===invite.amount,'DUEL_RESERVATION_INVARIANT');
    else if(invite.status!=='accepted')requireRule(!Object.hasOwn(inviter.account.reservations,key)&&!Object.hasOwn(inviter.account.escrows,key),'CANCELLED_DUEL_STAKE');
  }
  const completed=new Set<string>();
  for(const d of party.duelHistory){requireRule(d.status==='settled'&&!completed.has(d.id),'DUEL_HISTORY_INVARIANT');completed.add(d.id);}
  const duels=[...party.duelHistory,...(social?.duel&& !completed.has(social.duel.id)?[social.duel]:[])];
  for(const d of duels){
    requireRule(d.purpose===undefined||d.purpose==='LAST_STAND'||d.purpose==='BOUNTY','DUEL_PURPOSE_INVARIANT');
    requireRule((d.purpose==='LAST_STAND'?d.amount===0&&typeof d.ballotId==='string':validAmount(d.amount))&&d.inviterId!==d.defenderId,'DUEL_STAKE_INVARIANT');
    if(d.purpose==='LAST_STAND'){
      const ballot=party.overthrowHistory.find(b=>b.id===d.ballotId)??(social?.ballot?.id===d.ballotId?social!.ballot:null);
      requireRule(ballot&&ballot.houseId===d.defenderId&&ballot.challengerId===d.inviterId&&ballot.status===(d.status==='playing'?'playing':'settled'),'LAST_STAND_BALLOT_INVARIANT');
    }
    if(d.purpose==='BOUNTY')requireRule(d.amount===50&&typeof d.bountyId==='string'&&party.bounties.some(b=>b.id===d.bountyId&&b.targetId===d.defenderId),'BOUNTY_DUEL_INVARIANT');
    const ids=[d.inviterId,d.defenderId];
    requireRule(d.winnerId===null||ids.includes(d.winnerId),'DUEL_WINNER_INVARIANT');
    requireRule(d.throws.length<=5&&d.throws.every((t,i)=>t.number===i+1),'RPS_THROW_INVARIANT');
    for(const id of ids){
      const a=player(r,id).account,key=stakeKey(d.id,id);
      requireRule(!Object.hasOwn(a.reservations,key),'COMMITTED_DUEL_RESERVATION');
      if(d.purpose==='LAST_STAND')requireRule(!Object.hasOwn(a.escrows,key)&&!Object.hasOwn(a.settlements,key),'LAST_STAND_STAKE_INVARIANT');
      else if(d.status==='playing')requireRule(a.escrows[key]===d.amount&&!Object.hasOwn(a.settlements,key),'DUEL_ESCROW_INVARIANT');
      else requireRule(!Object.hasOwn(a.escrows,key)&&a.settlements[key]===(d.winnerId?(d.winnerId===id?2*d.amount:0):d.amount),'DUEL_SETTLEMENT_INVARIANT');
      requireRule(d.scores[id]===d.throws.filter(t=>t.winnerId===id).length,'RPS_SCORE_INVARIANT');
    }
    requireRule(Object.keys(d.choices).every(id=>ids.includes(id)&&['ROCK','PAPER','SCISSORS'].includes(d.choices[id])),'RPS_CHOICE_INVARIANT');
    if(d.status==='settled')requireRule(Object.keys(d.choices).length===0&&d.throwId===undefined,'SETTLED_DUEL_CHOICE');
    else if(d.game==='RPS')requireRule(typeof d.throwId==='string'&&d.throwNumber===d.throws.length+1,'LIVE_DUEL_INVARIANT');
    else if(d.game==='CONNECT4'){
      const board=d.connect4;requireRule(board&&typeof board.moveId==='string'&&ids.includes(board.activePlayerId)&&ids.includes(board.firstPlayerId),'CONNECT4_TURN_INVARIANT');
      requireRule(board.cells.length===6&&board.cells.every(row=>row.length===7&&row.every(cell=>cell===null||ids.includes(cell))),'CONNECT4_BOARD_INVARIANT');
      for(let column=0;column<7;column++){let seenPiece=false;for(let row=0;row<6;row++){if(board.cells[row][column]!==null)seenPiece=true;else requireRule(!seenPiece,'CONNECT4_GRAVITY_INVARIANT');}}
      requireRule(d.hardDeadline===d.startedAt+45000&&d.deadline<=d.hardDeadline,'CONNECT4_CLOCK_INVARIANT');
    }else if(d.game==='CHESS'){
      const board=d.chess;requireRule(board&&board.whiteId!==board.blackId&&ids.includes(board.whiteId)&&ids.includes(board.blackId)&&ids.includes(board.turnId)&&typeof board.moveId==='string','CHESS_TURN_INVARIANT');
      requireRule(ids.every(id=>Number.isFinite(board.remainingMs[id])&&board.remainingMs[id]>=0&&board.remainingMs[id]<=30000)&&d.hardDeadline===d.startedAt+60000&&d.deadline===Math.min(board.clockStartedAt+board.remainingMs[board.turnId],d.hardDeadline),'CHESS_CLOCK_INVARIANT');
      const chess=restoreChess(d);requireRule(board.turnId===(chess.turn()==='w'?board.whiteId:board.blackId),'CHESS_TURN_INVARIANT');
    }else requireRule(false,'LIVE_DUEL_INVARIANT');
  }
}
