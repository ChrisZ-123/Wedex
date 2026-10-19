// Select only untouched queued records; callers own all state transitions.
export function takeQueuedBatch(history,{maxMessages=100,maxChars=50000}={}) {
  if(!Array.isArray(history))throw new TypeError('队列历史必须是数组');
  if(!Number.isSafeInteger(maxMessages)||maxMessages<1||!Number.isSafeInteger(maxChars)||maxChars<1)throw new TypeError('队列批次限制必须是正整数');
  const batch=[];let characters=0;
  for(const message of history){
    if(message?.status!=='queued')continue;
    if(batch.length===maxMessages)break;
    if(typeof message.text!=='string')throw new TypeError('排队消息文本必须是字符串');
    const length=message.text.length+(batch.length?1:0);
    if(!batch.length&&length>maxChars)return [message];
    if(characters+length>maxChars)break;
    batch.push(message);characters+=length;
  }
  return batch;
}
