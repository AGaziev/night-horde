import { WEAPONS, DUOS, DUO_BY_PAIR, duoKey, forgeRecipe, AFFINITY, affinityOf, DUO_MIN_LEVEL, FORGE_MIN_LEVEL } from '/shared/content.js';
import { CONFLUENCES } from '/shared/confluences.js';

const codes = {vise:'Т',crossfire:'П',soak:'ПР',recoil:'О',drag:'В',aim:'Н'};
const node = (tag, text, cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};

export function setupCombinations() {
  const dialog=document.getElementById('combination-matrix');
  const table=dialog.querySelector('table'), summary=dialog.querySelector('[data-matrix-summary]');
  const rules=dialog.querySelector('[data-matrix-rules]');
  const ids=Object.keys(WEAPONS), buttons=[];
  let built=false;
  const describe=(a,b) => {
    const id=DUO_BY_PAIR[duoKey(a,b)], duo=DUOS[id], affinity=AFFINITY[affinityOf(a,b)], forge=forgeRecipe(a,b);
    summary.textContent=`${WEAPONS[a].name} + ${WEAPONS[b].name}`;
    rules.replaceChildren();
    if(duo){
      rules.append(node('p',`${duo.icon} ${duo.name}${CONFLUENCES[id]?' · новая связка':''}`),node('p',duo.desc),
        node('p',`Оба оружия ${DUO_MIN_LEVEL}-го уровня или выше. Сохраняет обе атаки с +${Math.round(((duo.inheritPower??1.2)-1)*100)}% урона и добавляет особую атаку. Освобождает один слот.`,'muted small'));
    } else if(affinity) rules.append(node('p',`${affinity.icon} ${affinity.name}`),node('p',affinity.desc),node('p','Сродство работает сразу, оружия остаются раздельными.','muted small'));
    if(forge) rules.append(node('p',`⚒ ${forge.name}: ${forge.desc}`),node('p',`Кузня: оба оружия ${FORGE_MIN_LEVEL}-го уровня или выше. ${WEAPONS[a].name} сохраняется, ${WEAPONS[b].name} поглощается. Один раз за забег на игрока.`,'muted small'));
    for(const entry of buttons)entry.button.setAttribute('aria-pressed',String(entry.a===a&&entry.b===b));
  };
  const build=()=>{
    if(built)return;built=true;
    const head=document.createElement('thead'), tr=node('tr');tr.append(node('th','Оружие ↓ / →'));
    for(const id of ids){const th=node('th');th.scope='col';th.append(node('span',WEAPONS[id].name,'matrix-column'));tr.append(th);}
    head.append(tr);const body=node('tbody');
    for(const a of ids){
      const row=node('tr'), label=node('th',WEAPONS[a].name);label.scope='row';row.append(label);
      for(const b of ids){
        const cell=node('td');
        if(a===b){cell.textContent='×';row.append(cell);continue;}
        const id=DUO_BY_PAIR[duoKey(a,b)], affinity=affinityOf(a,b), forge=forgeRecipe(a,b);
        const symbol=(id?(CONFLUENCES[id]?'★':'●'):codes[affinity]??'—')+(forge?'⚒':'');
        const button=node('button',symbol);button.type='button';button.className='matrix-cell';
        button.classList.toggle('matrix-duo',Boolean(id));button.classList.toggle('matrix-new',Boolean(CONFLUENCES[id]));
        const text=`${WEAPONS[a].name} + ${WEAPONS[b].name}: ${DUOS[id]?.name??AFFINITY[affinity]?.name??'нет рецепта'}${forge?'; кузня '+forge.name:''}`;
        button.setAttribute('aria-label',text);button.title=text;button.setAttribute('aria-pressed','false');
        button.addEventListener('click',()=>describe(a,b));buttons.push({button,a,b});cell.append(button);row.append(cell);
      }
      body.append(row);
    }
    table.append(head,body);describe('prism','tuning');
    dialog.querySelector('[data-matrix-count]').textContent=`${ids.length} оружий · ${Object.keys(DUOS).length} связок · ${Object.keys(CONFLUENCES).length} новых`;
  };
  for(const button of document.querySelectorAll('[data-open-combinations]'))button.addEventListener('click',()=>{build();dialog.showModal();});
}
