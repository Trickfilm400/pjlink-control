import net from 'net';
import crypto from 'crypto';

const defaultPort = 4352;
const maxRetries = 5;

export default class Projector {
  readonly url: string;
  readonly port: number;
  private _password: string;
  private _name: string | null = null;
  private _manufacturer: string | null = null;
  private _model: string | null = null;
  private _info: string | null = null;
  private _class: string | null = null;
  private _initialized = false;
  private _protocolVersion2Commands = ["SVOL", "IRES", "FREZ"];
  constructor(url: string, password: string, cb?: () => void, port?: number) {
    this.url = url;
    if (port == undefined) {
      this.port = defaultPort;
    } else this.port = port;
    this._password = password;
    this._sendCmd('NAME', '?')
      .then((name) => {
        this._name = name;
        return this._sendCmd('INF1', '?');
      })
      .then((man) => {
        this._manufacturer = man;
        return this._sendCmd('INF2', '?');
      })
      .then((model) => {
        this._model = model;
        return this._sendCmd('INFO', '?');
      })
      .then((info) => {
        this._info = info;
        return this._sendCmd('CLSS', '?');
      })
      .then((clas) => {
        this._class = clas;
        this._initialized = true;
        if (cb) cb();
      })
      .catch((err) => {
        console.error('Projector initialization error:' + JSON.stringify(err));
      });
  }

  get name() {
    return this._name;
  }

  get manufacturer() {
    return this._manufacturer;
  }

  get model() {
    return this._model;
  }

  get auxInfo() {
    return this._info;
  }

  private _killSocket(socket: net.Socket): Promise<void> {
    return new Promise((res, rej) => {
      if (socket) {
        let ended = false;
        socket.on('close', () => {
          ended = true;
          res();
        });
        socket.end();
        setTimeout(() => {
          socket.removeAllListeners();
          if (!ended) {
            socket.destroy();
            rej('Projector failed to close socket');
          }
        }, 200);
      }
    });
  }

  private _sendCmd(
    cmd: string,
    arg: number,
    retry?: number,
    err?: any
  ): Promise<void>;
  private _sendCmd(
    cmd: string,
    arg: '?',
    retry?: number,
    err?: any
  ): Promise<string>;
  private _sendCmd(
    cmd: string,
    arg: number | '?',
    retry?: number,
    err?: any
  ): Promise<void | string> {
    let PROTOCOL_VERSION = "%1"
    if (this._protocolVersion2Commands.includes(cmd.toUpperCase())) PROTOCOL_VERSION = "%2"
    if (!retry) retry = 0;
    return new Promise((res, rej) => {
      if (retry! > maxRetries) {
        rej(err);
        return;
      }
      let query = false;
      if (arg == '?') query = true;
      const argString = arg == '?' ? '?' : arg.toString();
      let ending = false;
      let socket = new net.Socket();
      socket.on('data', (buf) => {
        if (buf.slice(0, 9).toString() == 'PJLINK 1 ') {
          //return password encypted with 8 character random string supplied by the projector
          socket.write(
            Buffer.from(
              crypto
                .createHash('md5')
                .update(buf.slice(9, -1).toString() + this._password)
                .digest('hex') +
                PROTOCOL_VERSION +
                cmd +
                ' ' +
                argString +
                '\r'
            )
          );
        } else if (buf.slice(0, 8).toString() == 'PJLINK 0') {
          socket.write(Buffer.from(PROTOCOL_VERSION + cmd + ' ' + argString + '\r'));
        } else {
          ending = true;
          this._killSocket(socket)
            .then(() => {
              if (buf.slice(0, 7).toString() == PROTOCOL_VERSION + cmd + '=') {
                if (!query) {
                  if (buf.slice(7, 9).toString() == 'OK') {
                    res();
                  } else {
                    this._sendCmd(
                      cmd,
                      arg as '?',
                      retry! + 1,
                      'Projector returned error: ' + buf.slice(7).toString()
                    )
                      .then((rtn) => {
                        res(rtn);
                      })
                      .catch(rej);
                  }
                } else res(buf.slice(7).toString());
              } else
                this._sendCmd(
                  cmd,
                  arg as '?',
                  retry! + 1,
                  'Unexpected answer from projector'
                )
                  .then((rtn) => {
                    res(rtn);
                  })
                  .catch(rej);
            })
            .catch(rej);
        }
      });
      socket.on('error', (err) => {
        console.error('Projector socket error: ' + JSON.stringify(err));
      });
      socket.connect(this.port, this.url);
      setTimeout(() => {
        if (!ending) {
          this._killSocket(socket)
            .then(() => {
              this._sendCmd(
                cmd,
                arg as '?',
                retry! + 1,
                'Failed command to projector'
              )
                .then((rtn) => {
                  res(rtn);
                })
                .catch(rej);
            })
            .catch(() => {
              this._sendCmd(
                cmd,
                arg as '?',
                retry! + 1,
                'Failed command to projector, failed to close socket, command: %1' +
                  cmd +
                  ' ' +
                  arg.toString()
              )
                .then((rtn) => {
                  res(rtn);
                })
                .catch(rej);
            });
        }
      }, 2000);
    });
  }

  power(state: 'on' | 'off') {
    //@ts-ignore
    state = state.toLowerCase();
    switch (state) {
      case 'on':
        return this._sendCmd('POWR', 1).catch(console.error);
        break;
      case 'off':
        return this._sendCmd('POWR', 0).catch(console.error);
        break;
      default:
        return new Promise((res, rej) => {
          rej('Invalid power command');
        });
    }
  }

  getPower(): Promise<'on' | 'off' | 'cooling' | 'warm-up'> {
    return new Promise((res, rej) => {
      this._sendCmd('POWR', '?')
        .then((val) => {
          switch (val.slice(0, -1)) {
            case '0':
              res('off');
              break;
            case '1':
              res('on');
              break;
            case '2':
              res('cooling');
              break;
            case '3':
              res('warm-up');
              break;
            default:
              rej(val.slice(0, -1));
          }
        })
        .catch(rej);
    });
  }

  getLamp(): Promise<number> {
    return new Promise((res, rej) => {
      this._sendCmd('LAMP', '?')
        .then((val) => {
          const length = val.indexOf(' ');
          if (length === -1) {
            rej(val);
          } else {
            const hours = parseInt(val.slice(0, length));
            if (hours.toString().padStart(length, '0') === val.slice(0, length)) {
              res(hours);
            } else rej(val);
          }
        })
        .catch(rej);
    });
  }

  getInput(): Promise<string> {
    return new Promise((res, rej) => {
      this._sendCmd('INPT', '?')
        .then((rtn) => {
          switch (rtn.slice(0, 1)) {
            case '1':
              res('RGB ' + rtn.slice(1, 2));
              break;
            case '2':
              res('Video ' + rtn.slice(1, 2));
              break;
            case '3':
              res('Digital ' + rtn.slice(1, 2));
              break;
            case '4':
              res('Storage ' + rtn.slice(1, 2));
              break;
            case '5':
              res('Network ' + rtn.slice(1, 2));
              break;
            default:
              res('Unknown Input: ' + rtn);
              break;
          }
        })
        .catch(rej);
    });
  }

  setVolume(state: "increase" | "decrease") {
    switch (state) {
      case 'increase':
        return this._sendCmd('SVOL', 1).catch(console.error);
        break;
      case 'decrease':
        return this._sendCmd('SVOL', 0).catch(console.error);
        break;
      default:
        return new Promise((res, rej) => {
          rej('Invalid volume instruction');
        });
    }
  }

  setVideoMute(state: "on" | "off") {
    switch (state) {
      case 'on':
        return this._sendCmd('AVMT', 11).catch(console.error);
        break;
      case 'off':
        return this._sendCmd('AVMT', 10).catch(console.error);
        break;
      default:
        return new Promise((res, rej) => {
          rej('Invalid video mute instruction');
        });
    }
  }

  setAudioMute(state: "on" | "off") {
    switch (state) {
      case 'on':
        return this._sendCmd('AVMT', 21).catch(console.error);
        break;
      case 'off':
        return this._sendCmd('AVMT', 20).catch(console.error);
        break;
      default:
        return new Promise((res, rej) => {
          rej('Invalid audio mute instruction');
        });
    }
  }

  setVideoAndAudioMute(state: "on" | "off") {
    switch (state) {
      case 'on':
        return this._sendCmd('AVMT', 31).catch(console.error);
        break;
      case 'off':
        return this._sendCmd('AVMT', 30).catch(console.error);
        break;
      default:
        return new Promise((res, rej) => {
          rej('Invalid video and audio mute instruction');
        });
    }
  }


  getVideoAndAudioMute(): Promise<{ videoMuted: boolean, audioMuted: boolean }> {
    return new Promise((res, rej) => {
      let result: {videoMuted: boolean, audioMuted: boolean} = <never>{
        videoMuted: null,
        audioMuted: null
      }
      this._sendCmd('AVMT', '?')
          .then((val) => {
            switch (val.slice(0, -1)) {
              case '11':
                result.audioMuted = false
                result.videoMuted = true
                break;
              case '21':
                result.audioMuted = true
                result.videoMuted = false
                break;
              case '31':
                result.audioMuted = true
                result.videoMuted = true
                break;
              case '30':
                result.audioMuted = false
                result.videoMuted = false
                break;
              default:
                rej(val.slice(0, -1));
                return;
            }
            res(result)
          })
          .catch(rej);
    });
  }

  getInputResolution(): Promise<string> {
    return new Promise((res, rej) => {
      this._sendCmd('IRES', '?')
          .then((val) => {
            res(val)
          })
          .catch(rej);
    });
  }
  setFreeze(state: "on" | "off") {
    switch (state) {
      case 'on':
        return this._sendCmd('FREZ', 1).catch(console.error);
        break;
      case 'off':
        return this._sendCmd('FREZ', 0).catch(console.error);
        break;
      default:
        return new Promise((res, rej) => {
          rej('Invalid freeze instruction');
        });
    }
  }

  getFreeze(): Promise<boolean> {
    return new Promise((res, rej) => {
      this._sendCmd('FREZ', '?')
          .then((val) => {
            res(val === "1")
          })
          .catch(rej);
    });
  }

  getAvailableInputList() {
    return new Promise<string[]>((resolve, reject) => {
      this._sendCmd("INST", "?").then(res => {
        //example output: 11 12 32 33 41 52 56 57 58
        const inputs = res.trim().split(" ")
        resolve(inputs)
      }).catch(reject);
    });
}

  setInputByDirectNumber(input: number) {
    return new Promise<void>((res, rej) => {
      this._sendCmd('INPT', input)
          .then(() => {
            res();
          })
          .catch((err) => {
            if (err == 'Projector returned error: ERR2\r') {
              rej(`Input "${input}" does not exist`);
            } else rej(err);
          });
    });
  }


  input(
    type: 'RGB' | 'Video' | 'Digital' | 'Storage' | 'Network' | number,
    number?: number
  ): Promise<void> {
    let inputStr = '31';
    if (!number) number = 1;
    if (typeof type == 'number') {
      inputStr = type.toString();
    } else {
      switch (type) {
        case 'RGB':
          inputStr = '1';
          break;
        case 'Video':
          inputStr = '2';
          break;
        case 'Digital':
          inputStr = '3';
          break;
        case 'Storage':
          inputStr = '4';
          break;
        case 'Network':
          inputStr = '5';
          break;
        default:
          inputStr = '3';
          break;
      }
      inputStr += number.toString();
    }
    return new Promise((res, rej) => {
      this._sendCmd('INPT', parseInt(inputStr))
        .then(() => {
          res();
        })
        .catch((err) => {
          if (err == 'Projector returned error: ERR2\r') {
            rej('Input ' + type + ' ' + number + ' does not exist');
          } else rej(err);
        });
    });
  }
}
