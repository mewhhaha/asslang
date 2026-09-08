import { reverseVJP, reusablePullback } from './reverse.mjs';
import { forwardLinearize, reusableLinearize, valueAndGradient, stopGradient } from './differential.mjs';
// Closed compiler registry: source programs cannot install handlers or gain I/O.
export const intrinsicArities=Object.freeze({jvp:3,vjp:3,pullback:2,linearize:2,grad:2,value_and_grad:2,stop_gradient:1});
export function inferIntrinsic(name,{a,b,Num,fn}) {
  if(name==='pullback')return fn([fn([a],b),a],{tag:'Record',tail:null,
    fields:new Map([['value',b],['pullback',fn([b],a)]])});
  if(name==='vjp')return fn([fn([a],b),a,b],{tag:'Record',tail:null,
    fields:new Map([['value',b],['cotangent',a]])});
  if(name==='jvp')return fn([fn([a],b),a,a],{tag:'Record',tail:null,
    fields:new Map([['value',b],['tangent',b]])});
  if(name==='linearize')return fn([fn([a],b),a],{tag:'Record',tail:null,
    fields:new Map([['value',b],['pushforward',fn([a],b)]])});
  if(name==='grad')return fn([fn([a],Num),a],a);
  if(name==='value_and_grad')return fn([fn([a],Num),a],{tag:'Record',tail:null,
    fields:new Map([['value',Num],['gradient',a]])});
  if(name==='stop_gradient')return fn([a],a);
  return null;
}
export function stageIntrinsic(name,args,api,at) {
  if(name==='pullback')return reusablePullback(...args,api,at);
  if(name==='vjp')return reverseVJP(...args,api,at);
  if(name==='jvp')return forwardLinearize(...args,api,at);
  if(name==='linearize')return reusableLinearize(...args,api,at);
  if(name==='grad'||name==='value_and_grad') {
    const result=valueAndGradient(...args,api,at);
    return name==='grad'?result.fields.get('gradient'):result;
  }
  if(name==='stop_gradient')return stopGradient(args[0],api,at);
  api.fail(`Unknown intrinsic '${name}'`,at,'E_NAME');
}
