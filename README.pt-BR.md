# DigiISP

*[Read in English](README.md)*

**Transforme um Digispark ou Franzininho baratinho num gravador USB de
microcontroladores AVR e grave chips direto do navegador, no computador ou no
celular. Sem instalar nada.**

➡️ **https://digiisp.postcogito.org**

O DigiISP são duas coisas que funcionam juntas:

- **Um firmware** para placas ATtiny85 (Digispark, Franzininho DIY) que as
  transforma em gravadores ISP. Ele fala o protocolo do USBasp, então o avrdude e
  a IDE do Arduino também podem usá-lo.
- **Um aplicativo web** que controla o gravador via WebUSB: identifica o chip,
  lê e grava a flash e a EEPROM, edita fusíveis e bits de trava com explicações
  em linguagem simples e mostra como ligar tudo. Também funciona com gravadores
  USBasp comuns. Em português e inglês.

## O truque: duas placas, nenhum gravador especial

Uma placa ATtiny85 tem poucos pinos livres para ser gravador: a USB ocupa dois,
o ISP precisa de mais quatro, e o quarto (o reset do alvo) só pode vir do
próprio pino RESET do ATtiny85, depois que ele vira um pino de E/S comum. Fazer
isso normalmente exige um gravador, ou um de alta tensão para desfazer.

O DigiISP resolve com **duas placas**:

1. A página instala o DigiISP na **primeira placa** pela USB, através do
   bootloader Micronucleus que já vem nela.
2. Você liga a primeira placa a uma **segunda placa** e segura o botão RESET da
   segunda (ou usa um jumper). A primeira placa grava nela o bootloader e o
   DigiISP, confere, e só então transforma o pino RESET dela em E/S.

A segunda placa vira um gravador completo, que pode criar outros sem ninguém
segurar botão. Ela continua recebendo atualizações de firmware pela USB, pela
página.

## Do que você precisa

- **Duas** placas ATtiny85 com Micronucleus: Digispark (e clones) ou
  Franzininho DIY. Digisparks novos vêm com Micronucleus 1.x; a página pode
  atualizá-lo para o 2.6.
- Alguns jumpers fêmea-fêmea (para um Digispark alvo, que não tem botão de
  reset, um cabo Y ou dois jumpers no mesmo pino).
- Um navegador com WebUSB: Chrome, Edge ou outro baseado no Chromium, ou o
  Chrome no Android com um adaptador USB OTG. Firefox e Safari não têm WebUSB.
- No Linux, permissão para usar o dispositivo: veja [udev](#permissões-no-linux).
  O Windows instala o driver certo (WinUSB) sozinho.

## O que ele grava

Cerca de 160 AVRs com ISP: ATtiny (13/25/45/85, 24/44/84, 2313 e muitos outros)
e ATmega (8, 168, 328P/PB, 32U4, 644, 1284, 2560, ...). A base de chips é gerada
a partir da do [avrdude](https://github.com/avrdudes/avrdude). A página desenha
as ligações para:

- Digispark e Franzininho DIY (como gravador ou alvo)
- Arduino Uno, Nano, Pro, Pro Mini e Pro Micro
- ATtiny12/13/15/25/45/85 avulsos em DIP-8
- qualquer placa com o conector ISP padrão de 6 pinos, e o cabo de 10 pinos do
  USBasp

Testado em hardware real até agora: ATtiny85 (Digispark, Franzininho),
ATmega328PB (clone de Arduino Nano). Ainda não: flash acima de 64 KB
(ATmega1280/2560).

## Usando com o avrdude

O DigiISP usa o protocolo e os IDs USB do USBasp, então o avrdude o encontra
como um clone de USBasp:

```sh
avrdude -c usbasp-clone -p m328p -U flash:w:sketch.hex:i
```

`-c usbasp-clone` aceita qualquer USBasp pelos IDs USB; o `-c usbasp` simples
também confere o nome do fabricante, que é outro no DigiISP.

## Permissões no Linux

```sh
sudo cp udev/60-digiisp.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
```

Depois reconecte a placa. (Instalar o pacote `avrdude` traz uma regra
equivalente.)

## Compilando

Está tudo neste repositório:

| Diretório | O que é |
|---|---|
| `firmware/` | firmware do ATtiny85 em C (V-USB), roda sob o Micronucleus |
| `firmware/bootloader/` | imagens do Micronucleus 2.6 usadas pelo bootstrap e pela atualização |
| `web/` | o aplicativo web (TypeScript, Vite, sem framework) |
| `tools/` | `digiisp`: lista placas, reinicia no bootloader, confere ligações (libusb) |
| `udev/` | permissões no Linux |
| `docs/` | [protocolo USB](docs/PROTOCOL.md), [fontes dos desenhos das placas](docs/BOARDS.md), [plano e histórico do projeto](docs/PLAN.md) (em inglês) |

**Firmware** (precisa de `gcc-avr`, `avr-libc` e da ferramenta de linha de
comando `micronucleus` para enviar):

```sh
cd firmware
make                          # gera digiisp.hex
make flash                    # envia: conecte a placa quando pedir
make upload                   # um DigiISP já rodando: reinicia no bootloader e envia
make upload SERIAL=54F6894A   # o mesmo, para uma entre várias placas
make release                  # copia para release/digiisp.hex, o firmware que o app web leva
```

O `firmware/release/digiisp.hex` fica no repositório: é o firmware que a página
instala e com o qual compara as placas, então é atualizado (com `make release`)
junto com o `DIGIISP_FW_VERSION` em `protocol.h`. É também o arquivo a usar com
outras ferramentas de envio.

Se o `micronucleus` não estiver no PATH, coloque
`MICRONUCLEUS = /caminho/do/micronucleus` em `firmware/local.mk`.

**Aplicativo web** (precisa só do Node 18 ou mais novo):

```sh
cd web
npm install
npm run dev      # abra no Chrome o endereço http://localhost mostrado
npm run build    # site estático em web/dist, pronto para copiar para qualquer servidor web
```

O WebUSB só funciona em HTTPS ou `localhost`. Para testar o servidor de
desenvolvimento no celular, habilite em `chrome://flags` a opção "Insecure
origins treated as secure" para o endereço do computador.

**Ferramenta de linha de comando** (precisa de `libusb-1.0-0-dev`):

```sh
make -C tools
tools/digiisp list     # placas, fusíveis, versões do firmware e do bootloader
tools/digiisp probe    # confere ligações: níveis dos pinos e a resposta do alvo
```

## Licença e créditos

O DigiISP é software livre sob a **GNU General Public License v2** (veja
[LICENSE](LICENSE)). Ele se apoia em:

- [V-USB](https://www.obdev.at/products/vusb/), da Objective Development
  (GPLv2), o driver USB por software do firmware; os IDs USB são os
  compartilhados do V-USB, dentro das regras dele
- [USBasp](https://www.fischl.de/usbasp/), de Thomas Fischl (GPLv2): o protocolo
  USB e o código ISP de que o firmware deriva
- [Micronucleus](https://github.com/micronucleus/micronucleus) (GPLv2):
  imagens do bootloader e do atualizador, sem modificações (fonte: tag v2.6 do
  projeto, veja [firmware/bootloader](firmware/bootloader/README.md)), e o
  protocolo de envio
- [avrdude](https://github.com/avrdudes/avrdude) (GPLv2): base de chips e
  descrições dos fusíveis
- os arquivos de projeto publicados do Digispark (Digistump), do Franzininho DIY
  e das placas Arduino e SparkFun (CC BY-SA), dos quais os desenhos das
  ligações foram medidos; veja [docs/BOARDS.md](docs/BOARDS.md)
