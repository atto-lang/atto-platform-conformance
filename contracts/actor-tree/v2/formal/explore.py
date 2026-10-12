"""Independent bounded protocol explorer. Not a replacement for TLC."""
from collections import deque

def check(enabled=()):
    init=(0,False,True,True,0,False)
    todo=deque([init]); visited={init}; transitions=0
    while todo:
        hop,stopped,schema,incarnation,effects,stale=state=todo.popleft()
        violations=[]
        if not schema: violations.append('NoSchemaSubstitution')
        if not incarnation: violations.append('NoABAIncarnationReuse')
        if effects!=hop: violations.append('ExactlyOnceDelivery')
        if violations: return len(visited),transitions,state,violations
        next_states=[]
        if not stopped and hop<4 and schema and incarnation:
            next_states.append((hop+1,stopped,schema,incarnation,effects+1,stale))
        if not stopped: next_states.append((hop,True,schema,incarnation,effects,stale))
        if stopped and not stale: next_states.append((hop,stopped,schema,incarnation,effects,True))
        if 'schema-swap' in enabled and not stopped and hop==1:
            next_states.append((2,stopped,False,incarnation,effects+1,stale))
        if 'incarnation-reuse' in enabled and not stopped and hop==2:
            next_states.append((3,stopped,schema,False,effects+1,stale))
        if 'duplicate-delivery' in enabled and hop==4 and effects==4:
            next_states.append((hop,stopped,schema,incarnation,5,stale))
        for ns in next_states:
            transitions+=1
            if ns not in visited: visited.add(ns);todo.append(ns)
    return len(visited),transitions,None,[]

if __name__=='__main__':
    states,edges,witness,errors=check()
    assert not errors,(witness,errors)
    print(f'BOUNDED_SAFE_PASS states={states} edges={edges}')
    for mutant,expected in [('schema-swap','NoSchemaSubstitution'),
                            ('incarnation-reuse','NoABAIncarnationReuse'),
                            ('duplicate-delivery','ExactlyOnceDelivery')]:
        states,edges,witness,errors=check((mutant,))
        assert expected in errors,(mutant,witness,errors)
        print(f'EXPECTED_MUTANT {mutant} states={states} edges={edges} violation={expected}')
