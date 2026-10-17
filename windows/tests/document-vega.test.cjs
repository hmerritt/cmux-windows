const {test}=require('node:test');
const assert=require('node:assert/strict');

test('Vega inline-data policy rejects loader and mark references while retaining ordinary URL columns',async()=>{
  const {parseVegaSource,firstVegaExternalReference}=await import('../renderer/document-vega.mjs');
  for(const spec of [
    {data:{url:'https://example.invalid/data'}},
    {layer:[{data:{url:'file:///private'}}]},
    {data:[{name:'table',url:{signal:'source'}}]},
    {marks:[{type:'image',encode:{enter:{url:{value:'https://example.invalid/image'}}}}]},
    {datasets:{table:{url:'https://example.invalid/data'}}}
  ]) {
    assert(firstVegaExternalReference(spec));
    assert.throws(()=>parseVegaSource(JSON.stringify(spec)),/external_chart/);
  }
  const spec={data:{values:[{url:'ordinary column',href:'not a request',src:'image label'}]},datasets:{table:[{url:'also a column'}]}};
  assert.equal(firstVegaExternalReference(spec),null);
  assert.deepEqual(parseVegaSource(JSON.stringify(spec)),spec);
  for(const source of ['null','42','[]','not JSON'])assert.throws(()=>parseVegaSource(source));
  assert.throws(()=>parseVegaSource(' '.repeat(250001)),/chart_limit/);
});
