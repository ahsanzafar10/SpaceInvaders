import { fromEvent, interval, Observable, of, BehaviorSubject } from 'rxjs';
import { map, filter, takeUntil, scan, merge, skipLast, tap, switchMap } from 'rxjs/operators';


// Classes
class Tick { constructor(public readonly elapsed: number) { } }
class Move { constructor(public readonly direction: number) { } }
class Shoot { constructor() { } }
class alienMove { constructor() { }}
class alienShoot { constructor() { }}
class restart { constructor() {} }


//A pure Random Number Generator
class RNG {
  // LCG using GCC's constants
  readonly m = 0x80000000// 2**31
  readonly a = 1103515245
  readonly c = 12345

  constructor(readonly state: number) { }
  
  Int() {
    return  (this.a * this.state + this.c) % this.m; 
  }
  Float(max: number) {
    // returns in range [0,1]
    return Math.floor(max * (this.Int() / (this.m - 1)));
  }
  next() {
    return new RNG(this.Int())
  }
}


// Types
type Key = 'ArrowLeft' | 'ArrowRight' | 'Space' | 'KeyR';

type State = Readonly<{
  ship: Body,
  bullet: ReadonlyArray<Circle>,
  exit: ReadonlyArray<Body>,
  objCount: number,
  aliens: ReadonlyArray<Alien>
  alienMovement: number,
  alienBullet: ReadonlyArray<Circle>,
  gameOver: boolean,
  score: number,
  shield: ReadonlyArray<Body>,
  rng: RNG,
  level: number,
  playerWon: boolean
}>


type Body = Readonly<{
  x: number, 
  y: number
  viewType: string,
  id: string
  movement: number
   // Add a Collision Method
}>

interface Circle extends Body {
  readonly radius: number
   // Add a Collision Method
}
interface Alien extends Circle {
  readonly row_2D: number,
  readonly col_2D: number
}

type ViewType = 'ship' | 'alien' | 'bullet' | 'alienBullet' | "shield";


// Constants
const
  Constants = {
    column: 5,
    nullAlien: {
      viewType: "alien",
      id: null,
      x: null,
      y: null,
      movement: null,
      radius: null,
      row_2D: Number.NEGATIVE_INFINITY,
      col_2D: Number.NEGATIVE_INFINITY
    }
  } as const


// Document Functions
/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
 function flatMap<T,U>(
  a:ReadonlyArray<T>,
  f:(a:T)=>ReadonlyArray<U>
): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f));
}

/**
 * array a except anything in b
 * @param eq equality test function for two Ts
 * @param a array to be filtered
 * @param b array of elements to be filtered out of a
 */ 
 const except = 
 <T>(eq: (_:T)=>(_:T)=>boolean)=>
   (a:ReadonlyArray<T>)=> 
     (b:ReadonlyArray<T>)=> a.filter(not(elem(eq)(b)))

      
/**
 * Composable not: invert boolean result of given function
 * @param f a function returning boolean
 * @param x the value that will be tested with f
 */
const not = <T>(f: (x: T) => boolean) => (x: T) => !f(x)


/**
 * is e an element of a using the eq function to test equality?
 * @param eq equality test function for two Ts
 * @param a an array that will be searched
 * @param e an element to search a for
 */
const elem = 
 <T>(eq: (_:T)=>(_:T)=>boolean)=> 
   (a:ReadonlyArray<T>)=> 
     (e:T)=> a.findIndex(eq(e)) >= 0

/**
 * set a number of attributes on an Element at once
 * @param e the Element
 * @param o a property bag
 */         
const attr = (e:Element,o:Object) =>
 { for(const k in o) e.setAttribute(k,String(o[k])) }


/**
 * Returns a random integer between min (inclusive) and max (exclusive)
 * @param min Minimum number
 * @param max Maximum number
 */   
function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}



/**
 * Returns an observable that listens for events @param e of key  @param k.
 * This oversable is mapped to a stream of T objects (specified in @param resut)
 */   
const observeKey = <T>(e: string, k: Key, result: () => T) =>
  fromEvent<KeyboardEvent>(document, e)
    .pipe(
      filter(({ code }) => code === k),
      filter(({ repeat }) => !repeat),
      map(result));




/**
 * State Transducer
 */ 
const reduceState = (s: State, e: Move | Shoot | Tick | alienMove | alienShoot | restart) =>  

  // If player has won, then return inital state, and increase level    
  (s.playerWon)             ? {...initialState, 
                              shield: s.shield,
                              alienMovement: (s.level+1)*s.alienMovement, 
                              level: s.level + 1, 
                              exit: s.shield.concat(s.aliens, s.alienBullet,s.bullet), 
                              score: s.score, objCount:s.objCount} :
  // If restart has been initiated, then return initial state.
  (e instanceof restart)    ? {...initialState, exit: s.shield.concat(s.aliens, s.alienBullet,s.bullet)} :
  // If gameOver, do not process tick. Just return the current state.
  ((s.gameOver))            ? s :
  
  // The other in-game possibilities
  (e instanceof Move)       ? {...s, ship: { ...s.ship, movement: e.direction }} : 
  (e instanceof Shoot)      ? {...s, bullet: s.bullet.concat([createShipBullet(s.ship.x)(s.ship.y)(s.objCount)]), objCount: s.objCount + 1} : 
  (e instanceof alienShoot) ? makeAlienShoot(s): 
  (e instanceof alienMove)  ? changeAlienPos(s):
                              tick(s, e.elapsed);
                                  
  
  


/**
 * Funtion is responsible for making aliens shoot bullets.
 * Returns a new state of the game with a newly created bullet.
 */   
function makeAlienShoot(s: State): State {

  /* We make use of the core concept of functional programming here.
  We create small, pure, curried functions. We then use these small functions
  to create more complex funtions.

  In line 226, we define a curried function "aliensinColumn", which returns
  all the aliens in a given column. 
  In bottomAlienInColumn() function, we use partial application by passing
  the column number to curried aliensInColumn() function.
  This returns a new function which is waiting for an alien to be passd in.
  So, we can use this inside our filter function in Line 228.

  Additionally, by making small, pure functions, we were able to combine them
  to make more complex functions, which can be re-used. This is seen in 
  bottomAlienInColumn() function, which is being re-used for each column
  to obtain the bottom alien.
  */


  // We use the 2D x&y coordinate (row_2D and col_2D respectively) to determine the bottom alien in a column.
  const
    aliensInColumn = (column: number) => (alien: Alien) => alien.col_2D === column,
    getBottomAlien = (accAlien: Alien, currentAlien: Alien) => currentAlien.row_2D > accAlien.row_2D ? currentAlien : accAlien,
    bottomAlienInColumn = (column: number) => s.aliens.filter(aliensInColumn(column)).reduce(getBottomAlien, Constants.nullAlien);

  // Each column 0, column 1 ... column 4 variables store the bottom most alien in that particular column. 
  // If no alien exists in a particular column, it stores the nullAlien (defined in constants). This is
  // prevent performing a reduce to an empty array with no intial value.
  const  
    column0 = bottomAlienInColumn(0), column1 = bottomAlienInColumn(1), column2 = bottomAlienInColumn(2),
    column3 = bottomAlienInColumn(3),column4 = bottomAlienInColumn(4);

  // If no aliens in a column, we filter that column out.
  // We choose a random bottom alien to shoot using our Pure RNG.
  const bottomRowAliens = [column0, column1, column2, column3, column4].filter(alien => alien.id !== null);
  const randomAlien = s.rng.Float(bottomRowAliens.length) 
  const alienToShoot: Alien = bottomRowAliens[randomAlien];

  return <State>{
    ...s,
    alienBullet:(bottomRowAliens.length) > 0  ? 
                      s.alienBullet.concat([createAlienBullet(alienToShoot.x)(alienToShoot.y)(s.objCount)])
                      : s.alienBullet,
    objCount: s.objCount + 1,
    rng: s.rng.next(),
    playerWon: bottomRowAliens.length === 0
  };

}



/**
 * Function controls the movement of aliens.
 * Aliens move across and downwards.
 */ 
function changeAlienPos(s: State): State {

    // If any alien is out of bounds, flip the across movement, and shift aliens down.
    const aliensOutofBounds = s.aliens.filter( ({x}) => x<40 || x >= 560 )
    const alienMovement = aliensOutofBounds.length > 0 ? (-1)*s.alienMovement : s.alienMovement;
    const y_move =  aliensOutofBounds.length > 0 ? 20 : 0;
    
    return <State> {
        ...s,
        aliens: s.aliens.map((alien)=> ({...alien, x: alien.x + alienMovement, y: alien.y + y_move})),
        alienMovement: alienMovement
    }
}

/**
 * Function handles all possible collisions within the game.
 */
const handleCollisions = (s: State): State => {

  type detectCollisionFunction<T extends Body,V extends Body> = (body1: T , body2: V) => boolean;
  const 
    /*
    bodiesCollided() is a curried function which excepts a function, and 2 respective bodies.
    Checks if a collision has occured betweeen body 1 and body 2 using a function as the predicate. Returns a boolean.
    */
    bodiesCollided =  <T extends Body,V extends Body> (checkCollision: detectCollisionFunction<T,V>) => ([body1, body2]: [T, V]) => 
      checkCollision(body1,body2),
    cut = except(<T extends Body, V extends Body>  (a: T) => (b: V) => a.id === b.id);

  /*
   getCollisionInfo() function accepts two arrays of bodies (namely, allBody1 and allBody2
    respectively).
   Example, allBody1 is an array of all ship bullets, and allBody2 is an array of all aliens.

   It uses the bodiesCollided() function defined above, as well as flatMap to obtain all
   collisions have occured.

   Finally, we return an object, where the first property contains all bodies from allBody1
   that were invovled in a collision, and where the second property contains all bodies
   from allBody2 that were involved in a collision.
  */
  function getCollisionInfo<T extends Body, V extends Body>(allBody1: ReadonlyArray<T>, allBody2: ReadonlyArray<V>, f: detectCollisionFunction<T, V>) {

    // Returns an array of the form [{Body1}, {Body2}] if Body1 and Body2 have collided by the definition of f.
    const collidedBodies = flatMap(allBody1, b1 => allBody2.map<[T, V]>(b2 => ([b1, b2])))
      .filter(bodiesCollided(f)); // Using partial appication of  curried function bodiesCollided()
    const collidedBody1: ReadonlyArray<T> = collidedBodies.map((([body1, _]) => body1));
    const collidedBody2: ReadonlyArray<V> = collidedBodies.map((([_, body2]) => body2));
    return {
      collidedBody1,
      collidedBody2
    }
  }

  /*
  This section checks for any conditon that may cause a game to be over (i.e. cause the player to lose).
  All these variables are booleans. 
  */
  const
    // Collision between Ship and Alien 
    shipCollidedWithAlien = s.aliens
                            .filter(alien => bodiesCollided(collisionCircleCheck)([s.ship, alien])).length > 0,
    // Collisions between Alien Bullets and Ship.
    shipCollidedWithAlienBullet = s.alienBullet
                                  .filter(AlienBull => bodiesCollided(collisionWithShip)([s.ship, AlienBull])).length > 0,
    // Check if any alien is below canvas
    alienPassedCanvas = s.aliens.filter(alien => alien.y > 580).length > 0,
    gameOver = shipCollidedWithAlien || shipCollidedWithAlienBullet || alienPassedCanvas;
  

    /* 
    The below sections check for collisions between bodies. The collidedShieldsAndAlienBullets() function
    is re-used for each case.
    */
  // Allien bullets colliding with Shields
  const 
    collidedShieldsAndAlienBullets = getCollisionInfo(s.alienBullet, s.shield, collisionShieldCheck),
    alienBull = collidedShieldsAndAlienBullets.collidedBody1,
    shields = collidedShieldsAndAlienBullets.collidedBody2
  // Ship bullets colliding with Shields
  const 
    collidedShieldsAndShipBullets = getCollisionInfo(s.bullet, s.shield,collisionShieldCheck),
    shipBull = collidedShieldsAndShipBullets.collidedBody1,
    shields2 = collidedShieldsAndShipBullets.collidedBody2;
  // Ship bullets colliding and Aliens
  const    
    collidedBulletsAndAliens = getCollisionInfo(s.bullet, s.aliens, collisionCircleCheck),
    shipBull2 = collidedBulletsAndAliens.collidedBody1,
    aliens = collidedBulletsAndAliens.collidedBody2;
  
  return <State>{
    ...s,
    gameOver: gameOver,
    bullet: cut(s.bullet)(shipBull2.concat(shipBull)),
    aliens: cut(s.aliens)(aliens),
    exit: s.exit.concat(shipBull2, aliens, alienBull, shields, shields2, shipBull),
    score: s.score + aliens.length * 10,
    shield: cut(s.shield)(shields.concat(shields2)),
    alienBullet: cut(s.alienBullet)(alienBull)
  }
  
}

const
  /* Function checks if a circle (body2) has collided with body1 */ 
  collisionCircleCheck = <T extends Body>(body1: T, body2: Circle) =>  
    Math.sqrt((body1.x-body2.x)**2+(body1.y-body2.y)**2) < 30,

  /* Function checks if the ship has collided with another body (body2) */
  collisionWithShip = (ship: Body, body2: Body) =>  
    (ship.x  - 35 < body2.x) && (body2.x < ship.x + 35) && (ship.y-5 < body2.y) && (body2.y < ship.y+5),

  /* Function checks if an alien (body1) has collided with another shield (body2) */
  collisionShieldCheck = (body1: Alien, body2: Body) =>
    (body2.x <= body1.x) && (body1.x < body2.x + 20) && (body2.y <= body1.y) && (body1.y < body2.y + 20)


/**
 * Interval tick: bodies move, bullets expire
 */
const tick = (s: State, elapsed: number) => {

  const not = <T>(f: (x: T) => boolean) => (x: T) => !f(x);
  const bulletInfo = (f: (y: number) => boolean, b: ReadonlyArray<Body>) => {
      return {
        expired: b.filter((b: Body) => f(b.y)),
        active: b.filter((b: Body) => not(f)(b.y))
      }
    }
   
   /* 
   The logic to calculate active and expired bulelts for shipBullets 
   and alienBullets is exactly the same. So, to reduce duplication 
   of code, we create the bulletInfo() function which can be re-used.
   */ 


  // A ship bullet expires when it exceeds the top of the canvas.
  // An alien bullet expires when it exceeds the bottom of the canvas.
  const shipbullets = bulletInfo((y=>y<=0),s.bullet);
  const alienBullets = bulletInfo((y=>y>=600),s.alienBullet);


  return handleCollisions({
    ...s,
    ship: moveShip(s.ship),
    bullet: shipbullets.active.map(moveCircle(0,-8)),
    exit: shipbullets.expired.concat(alienBullets.expired),
    alienBullet: alienBullets.active.map(moveCircle(0, 2))
  })
}





  



const
  moveCircle = (x: number, y: number) => (b:Circle) => <Circle>{...b, x:b.x + x, y: b.y + y},
  moveShip = (b: Body) => <Body> {
    // If a ship moves to the left of canvas, it is shifted to appear on the right.
    ...b, 
    x: (b.x+b.movement < 0)  ? 600 : 
       (b.x+b.movement> 600) ? 0 :
                              b.x + b.movement
  }


const createShield = (viewType: ViewType) => (x_p: number) => (y_p: number) => (oid: number) =>
  <Body>{
    viewType: viewType,
    id: viewType + oid,
    x: y_p * 20 + 20,
    y: x_p * 20 + 520,
    movement: 0
  }



/**
 * Aliens, AlienBullets and ship Bullets are all circles.
 */
 const
 createCircle = (viewType: ViewType) => (radius: number) => (x: number) => (y: number) => (oid: number) => 
   <Circle>{
     viewType: viewType,
     id: viewType + oid,
     x,
     y,
     movement: 0,
     radius: radius,
   },

 // ShipBullet and AlienBullet are just circles. 
 createShipBullet = createCircle("bullet")(3),
 createAlienBullet = createCircle("alienBullet")(5)

// An alien extends from a circle. 
function createAlien(x: number, y: number, oid: number) : Alien {
 const alien = createCircle("alien")(30)(x)(y)(oid);
 return <Alien> {
   ...alien,
   // We map each index to a 2D x&y coordinate. 
   // This allows us to figure out whether an
   // alien is the bottom most in a column.
   row_2D: Math.floor(oid / Constants.column), 
   col_2D: oid % Constants.column
 }
}
  
 


/* Each shield will appear as a rectangle on the canvas.
   A shield is made up of small rectangle objects. 
   The shield will deterirate as it collides with bullets.
*/ 
const 
  shield1 = [...Array(10)]
            .map((item, index) => createShield("shield")(Math.floor(index / 5))(index % 5)(index)),
  shield2 = [...Array(10)]
            .map((item, index) => createShield("shield")(Math.floor(index / 5))(7 + (index % 5))(index + 10)),
  shield3 = [...Array(10)]
            .map((item, index) => createShield("shield")(Math.floor(index / 5))(16 + (index % 5))(index + 20)),
  shield4 = [...Array(10)]
  .map((item, index) => createShield("shield")(Math.floor(index / 5))(23 + (index % 5))(index + 30));

const startAliens = [...Array(10)]
  .map((item, index) => (index >= 0 && index <= 4) ? createAlien(index * 75 + 150,80,index)
    : createAlien(index * 75 - 225,160,index))

const
  initialState: State = {
    ship: { viewType: "ship", id: "ship", x: 300, y: 580, movement: 0},
    bullet: [],
    exit: [],
    objCount: 0,
    aliens: startAliens,
    alienMovement: -1,
    alienBullet: [],
    gameOver: false,
    score: 0,
    shield: shield1.concat(shield2, shield3, shield4),
    rng: new RNG(Math.floor(100*Math.random())),
    level:1,
    playerWon: false
  }



// Main
function spaceinvaders() {



  // Initialise following obervables that are listening for keyboard events
  const
    startLeftMove$ = observeKey('keydown', 'ArrowLeft', () => new Move(-1)),
    stopLeftMove$ = observeKey('keyup', 'ArrowLeft', () => new Move(0)),
    startRightMove$ = observeKey('keydown', 'ArrowRight', () => new Move(1)),
    stopRightMove$ = observeKey('keyup', 'ArrowRight', () => new Move(0)),
    shoot$ = observeKey('keydown', 'Space', () => new Shoot()),
    alienMove$ = interval(10).pipe(map((_)=>new alienMove())),
    alienShoot$ = interval(1000).pipe(map(_ => new alienShoot())),
    restart$ = observeKey('keydown', 'KeyR', () => new restart());

  // Main gameClock observable
  interval(10).pipe(
    map(elapsed => new Tick(elapsed)),
    merge(startLeftMove$, stopLeftMove$, startRightMove$, stopRightMove$, 
      shoot$, alienMove$, alienShoot$, restart$),
    scan(reduceState, initialState)
  ).subscribe((_) => {
    updateView(_);
  })

  // All side-effects are contained within this function
  function updateView(s: State) {

    const
      ship = document.getElementById("ship")!,
      svg = document.getElementById("svgCanvas")!,
      score = document.getElementById("score"),
      level = document.getElementById("level");
    
    if(s.gameOver) {
      //subscription.unsubscribe();
      const v = document.getElementById("gameover");
      if (!v) {
        const v = document.createElementNS(svg.namespaceURI, "text")!;
        attr(v,{
        id: "gameover" ,
        x: 600/6,
        y: 600/2,
        class: "gameover"
      });
      v.textContent = "Game Over";
      svg.appendChild(v);
      }
      
    } else {
      const v = document.getElementById("gameover");
      if (v) svg.removeChild(v)
    }

    score.innerHTML = `Score: ${s.score}`
    level.innerHTML = `Level: ${s.level}`
    ship.setAttribute('transform', `translate(${s.ship.x}, ${s.ship.y})`);
  
    // =============================================
    const getFill = (viewType: ViewType) => viewType==="bullet" ? '#95B3D7'
        : viewType == "alien" ? "pink" : viewType == "alienBullet" ? "orange" : "lightgreen";
  
    const updateBodyView = (b: Circle) => {
      function createBodyView(){

        if (b.viewType === "shield") {
          const v = document.createElementNS(svg.namespaceURI, "rect")!;
          attr(v, { id: b.id, width: 20, height: 20, x:b.x, y:b.y });
          v.setAttribute("fill",getFill(<ViewType>b.viewType));
          v.classList.add(b.viewType)
          svg.appendChild(v)
          return v;
        }

        else {
          const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
          attr(v, { id: b.id, rx: b.radius, ry: b.radius });
          v.setAttribute("fill",getFill(<ViewType>b.viewType));
          v.classList.add(b.viewType)
          svg.appendChild(v)
        return v;
        }

      }
  
      const v = document.getElementById(b.id) || createBodyView();
      attr(v, { cx: b.x, cy: b.y });
    }
  
    s.bullet.forEach(updateBodyView);
    s.aliens.forEach(updateBodyView);
    s.alienBullet.forEach(updateBodyView);
    s.shield.forEach(updateBodyView);
  
  
    s.exit.forEach(o => {
      const v = document.getElementById(o.id);
      if (v) svg.removeChild(v)
    })
  }



}

// the following simply runs your pong function on window load.  Make sure to leave it in place.
if (typeof window != 'undefined')
  window.onload = () => {
    spaceinvaders();
  }



