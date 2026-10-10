const list = (s) => s.split(',').map((w) => w.trim()).filter(Boolean);

// Easy: short, concrete, instantly drawable things.
export const EASY_WORDS = list(`apple,banana,pizza,cake,egg,carrot,cookie,donut,ice cream,cheese,
dog,cat,fish,bird,cow,pig,duck,frog,snake,bee,spider,lion,mouse,horse,rabbit,turtle,snail,whale,
sun,moon,star,cloud,rain,rainbow,tree,flower,leaf,mountain,
house,car,bus,boat,train,bike,plane,rocket,
ball,book,pen,cup,hat,shoe,sock,shirt,key,door,window,chair,bed,table,clock,lamp,phone,
heart,smile,eye,hand,foot,nose,ear,tooth,
box,bag,gift,kite,balloon,candle,bell,ring,crown,flag,
snowman,ghost,robot,fork,spoon,bottle,umbrella,ladder,tent,bone`);

// Medium: the classic mix.
export const MEDIUM_WORDS = list(`watermelon,pineapple,sandwich,popcorn,sushi,taco,burger,hot dog,french fries,spaghetti,pancake,cupcake,lollipop,
elephant,giraffe,monkey,penguin,shark,octopus,kangaroo,zebra,panda,koala,camel,owl,bat,butterfly,crab,dolphin,
jellyfish,seahorse,peacock,flamingo,parrot,hedgehog,squirrel,raccoon,fox,wolf,bear,unicorn,dragon,dinosaur,
castle,bridge,lighthouse,igloo,pyramid,school,hospital,barn,skyscraper,windmill,
helicopter,motorcycle,skateboard,tractor,submarine,ambulance,fire truck,
lightning,tornado,volcano,island,beach,waterfall,desert,forest,cave,cactus,mushroom,palm tree,sunflower,
laptop,television,camera,headphones,keyboard,watch,lock,glasses,backpack,wallet,scissors,hammer,bucket,
sofa,stairs,toilet,bathtub,mirror,fridge,oven,microwave,toaster,dress,glove,scarf,tie,
guitar,piano,drum,violin,trumpet,microphone,football,basketball,baseball,tennis,golf,bowling,trophy,medal,
king,queen,pirate,ninja,wizard,zombie,vampire,mermaid,superhero,astronaut,clown,chef,doctor,police,farmer,
diamond,anchor,map,compass,treasure,sword,shield,bow and arrow,bomb,magnet,battery,lightbulb,
pencil,paintbrush,envelope,puzzle,dice,birthday,wedding,campfire,picnic,fireworks,
skeleton,beard,brain,spaceship,alien,planet,telescope,toothbrush,pillow,snowflake,fire,
traffic light,stop sign,mailbox,fountain,swing,slide,ferris wheel,roller coaster,cowboy,knight,mummy,angel`);

// Hard: actions, ideas and phrases that take creativity to draw.
export const HARD_WORDS = list(`gravity,echo,shadow,reflection,invisible,nightmare,jet lag,traffic jam,sleepwalking,brain freeze,
time travel,black hole,earthquake,evolution,recycling,hibernation,photosynthesis,eclipse,tsunami,avalanche,
procrastination,deja vu,awkward silence,social media,autocorrect,Monday morning,plot twist,stage fright,
homesick,daydream,hiccup,sneeze,yawn,blindfold,karaoke,yoga,meditation,marathon,tug of war,hide and seek,
high five,handshake,group hug,peer pressure,cold shoulder,piggy bank,bucket list,comfort zone,
password,wifi,virus,download,selfie,emoji,cloud storage,video call,low battery,screenshot,
lie detector,fortune teller,stock market,inflation,tax return,job interview,first date,blind date,
silent movie,soap opera,reality show,red carpet,standing ovation,encore,
sunburn,frostbite,heatwave,windchill,fog,tide,constellation,northern lights,
hangover,midnight snack,food coma,leftovers,doggy bag,potluck,buffet`);

export const WORDS = { easy: EASY_WORDS, medium: MEDIUM_WORDS, hard: HARD_WORDS };
