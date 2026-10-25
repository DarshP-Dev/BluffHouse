import {describe,expect,it} from 'vitest';
import type {ClaimType,Rank} from '@bluff-house/shared';
import {CLAIM_RULES,claimWins,isDeferredClaim,projectClaim} from '../../apps/server/src/game/claims.js';
import {shoe} from '../fixtures/core.js';

const cards=(ranks:Rank[])=>shoe(ranks).slice(0,ranks.length);
describe('released immediate and round-result claim predicates',()=>{
  it('lists the original immediate rule plus one new immediate and three explicitly deferred claims',()=>{
    expect(CLAIM_RULES.map(r=>[r.type,r.timing])).toEqual([['NEXT_HIT_SAFE','IMMEDIATE'],['NEXT_HIT_EXACT_21','IMMEDIATE'],['BEAT_DEALER','ROUND_RESULT'],['THREE_CARD_WIN','ROUND_RESULT'],['DEALER_BUST','ROUND_RESULT']]);for(const r of CLAIM_RULES)expect(isDeferredClaim(r.type)).toBe(r.timing==='ROUND_RESULT');expect(CLAIM_RULES.find(r=>r.type==='BEAT_DEALER')!.help).toMatch(/push.*fail|push.*loss.*fail/i);
  });
  it.each<[ClaimType,Rank[],Rank[],boolean]>([
    ['NEXT_HIT_SAFE',['6','6','3'],[],true],['NEXT_HIT_SAFE',['6','6','K'],[],false],['NEXT_HIT_EXACT_21',['6','6','9'],[],true],['NEXT_HIT_EXACT_21',['6','6','3'],[],false],['NEXT_HIT_EXACT_21',['6','6','K'],[],false],
    ['BEAT_DEALER',['10','9'],['10','8'],true],['BEAT_DEALER',['10','8'],['10','8'],false],['BEAT_DEALER',['A','K'],['10','A'],false],['BEAT_DEALER',['A','K'],['10','5','6'],true],['BEAT_DEALER',['10','5','6'],['A','K'],false],['BEAT_DEALER',['10','9','5'],['10','9','5'],false],
    ['THREE_CARD_WIN',['10','5','5'],['10','9'],true],['THREE_CARD_WIN',['10','10'],['10','9'],false],['THREE_CARD_WIN',['7','7','7'],['10','5','6'],false],['THREE_CARD_WIN',['10','8','4'],['10','6','6'],false],
    ['DEALER_BUST',['10','8','4'],['10','6','6'],true],['DEALER_BUST',['10','10'],['A','K'],false],['DEALER_BUST',['10','9'],['10','7'],false],
  ])('evaluates%s against the actual player/dealer outcomes',(type,hand,dealer,expected)=>{expect(claimWins(type,cards(hand),cards(dealer))).toBe(expected);});
});

describe('claim projection contains only verified public settlement evidence',()=>{
  it('omits all evidence, private proofs and frozen prefixes while a deferred claim is pending',()=>{
    const offer={id:'claim-id',claimantId:'a',challengerId:'b',amount:100,deadline:1000,status:'accepted' as const,claimType:'BEAT_DEALER' as const,timing:'ROUND_RESULT' as const,settlement:'pending' as const,pot:200,roundId:'round',lockedHands:{a:['secret-a'],b:['secret-b']},proof:{hand:cards(['10','8']),dealer:cards(['10','7'])},evidence:{playerTotal:18,playerCardCount:2,playerNatural:false,playerBust:false,claimTrue:true,dealerTotal:17}};
    const v=projectClaim(offer);expect(v).not.toHaveProperty('proof');expect(v).not.toHaveProperty('lockedHands');expect(v).not.toHaveProperty('evidence');expect(JSON.stringify(v)).not.toContain('secret');
  });
  it('whitelists settled immediate player evidence without exposing dealer or arbitrary injected fields',()=>{
    const offer={id:'claim-id',claimantId:'a',amount:100,deadline:1000,status:'accepted' as const,claimType:'NEXT_HIT_EXACT_21' as const,timing:'IMMEDIATE' as const,settlement:'settled' as const,evidence:{playerTotal:21,playerCardCount:3,playerNatural:false,playerBust:false,claimTrue:true,dealerTotal:17,dealerNatural:false,dealerBust:false,shoe:['secret']}};const v=projectClaim(offer);expect(v.evidence).toEqual({playerTotal:21,playerCardCount:3,playerNatural:false,playerBust:false,claimTrue:true});
  });
  it('copies whitelisted settled dealer evidence while retaining no mutable proof or extra fields',()=>{
    const offer={id:'claim-id',claimantId:'a',amount:100,deadline:1000,status:'accepted' as const,claimType:'DEALER_BUST' as const,timing:'ROUND_RESULT' as const,settlement:'settled' as const,evidence:{playerTotal:24,playerCardCount:3,playerNatural:false,playerBust:true,claimTrue:true,dealerTotal:22,dealerNatural:false,dealerBust:true,playerOutcome:'loss' as const,shoe:['secret']}};const v=projectClaim(offer);expect(v.evidence).toMatchObject({playerTotal:24,claimTrue:true,dealerTotal:22,dealerBust:true,playerOutcome:'loss'});expect(v.evidence).not.toHaveProperty('shoe');v.evidence!.dealerTotal=0;expect(offer.evidence.dealerTotal).toBe(22);
  });
});
