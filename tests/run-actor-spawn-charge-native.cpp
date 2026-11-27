// Compile against backend ActorSpawnChargePlan.hpp and pipe the TSV into stdin.
#include "ActorSpawnChargePlan.hpp"
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <set>
using namespace oreslang::spawn_charge;
static Affinity affinity(const std::string& s) {
    if(s=="none") return Affinity::none;
    if(s=="sticky") return Affinity::sticky;
    if(s=="pinned") return Affinity::pinned;
    throw std::runtime_error("bad vector affinity");
}
static std::string name(Affinity a) {
    if(a==Affinity::none) return "none";
    if(a==Affinity::sticky) return "sticky";
    if(a==Affinity::pinned) return "pinned";
    throw std::runtime_error("bad result affinity");
}
int main() {
    std::string line; std::set<std::string> ids; int accepts=0, denies=0;
    while(std::getline(std::cin,line)) {
        if(line.empty() || line[0]=='#') continue;
        std::istringstream in(line); std::vector<std::string> v;
        for(std::string s; std::getline(in,s,'\t');) v.push_back(s);
        if(v.size()!=19 || !ids.insert(v[0]).second) return 1;
        Policy p{v[1]=="1",std::stoi(v[2]),std::stoi(v[3]),std::stoll(v[4]),std::stoll(v[5]),std::stoll(v[6]),std::stoll(v[7]),std::stoll(v[8])};
        Defaults d{affinity(v[9]),std::stoll(v[10]),std::stoll(v[11]),std::stoll(v[12])};
        Request r{};
        if(v[13]!="-") r.carriers=std::stoi(v[13]);
        if(v[14]!="-") r.affinity=affinity(v[14]);
        if(v[15]!="-") r.heap_bytes=std::stoll(v[15]);
        if(v[16]!="-") r.stack_bytes=std::stoll(v[16]);
        if(v[17]!="-") r.mailbox_messages=std::stoll(v[17]);
        std::string actual;
        try {
            auto x=resolve(p,d,r); std::ostringstream out;
            out<<x.carrier_cap<<','<<name(x.affinity)<<','<<x.stack_bytes<<','<<x.heap<<','<<x.stacks<<','<<x.mailbox_bytes<<','<<x.messages;
            actual=out.str(); ++accepts;
        } catch(const std::invalid_argument& e) {actual=e.what(); ++denies;}
        if(actual!=v[18]) {std::cerr<<v[0]<<": expected "<<v[18]<<", got "<<actual<<'\n'; return 1;}
    }
    if(ids.size()!=25 || accepts!=6 || denies!=19) return 1;
    std::cout<<"SPAWN_CHARGE_NATIVE_HOST_PASS 6 accepts 19 denials; no guest execution\n";
}
