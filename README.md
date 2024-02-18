# pjlink-control

Minimal package for controlling projectors with the PJLink protocol.


## Basic Usage
```typescript
import Projector from 'pjlink-control'; //TypeScript
const Projector = require('pjlink-control').default; //JavaScript

let panasonic1 = new Projector("172.19.1.137", "panasonic", () => {
  console.log("connected");
  panasonic1.power('on').then(() => {
    return panasonic1.getInput()
  }).then((val) => {
    console.log('Input "' + val + '" active');
  })
});
```