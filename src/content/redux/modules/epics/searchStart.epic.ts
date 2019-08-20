import { switchMap, map, share, take, filter, tap } from 'rxjs/operators'
import { merge, from } from 'rxjs'
import { StoreAction } from '../'
import { Epic, ofType } from '../../utils/operators'
import { isInNotebook } from '@/_helpers/record-manager'
import { message } from '@/_helpers/browser-api'
import { isPDFPage } from '@/_helpers/saladict'
import { DictID } from '@/app-config'
import { MachineTranslateResult } from '@/components/dictionaries/helpers'

export const searchStartEpic: Epic = (action$, state$) =>
  action$.pipe(
    ofType('SEARCH_START'),
    switchMap(({ payload }) => {
      const {
        config,
        searchHistory,
        historyIndex,
        renderedDicts
      } = state$.value
      const word = searchHistory[historyIndex]

      const toStart = new Set<DictID>()
      for (const d of renderedDicts) {
        if (d.searchStatus === 'SEARCHING') {
          toStart.add(d.id)
        }
      }

      const { cn, en, machine } = config.autopron
      if (cn.dict) toStart.add(cn.dict)
      if (en.dict) toStart.add(en.dict)
      if (machine.dict) toStart.add(machine.dict)

      const searchResults$$ = merge(
        ...[...toStart].map(id =>
          message
            .send<'FETCH_DICT_RESULT'>({
              type: 'FETCH_DICT_RESULT',
              payload: {
                id,
                text: word.text,
                payload:
                  payload && payload.payload
                    ? { isPDF: isPDFPage(), ...payload.payload }
                    : { isPDF: isPDFPage() }
              }
            })
            .catch(() => ({ id, result: null, audio: null }))
        )
      ).pipe(share())

      const playAudio$ = searchResults$$.pipe(
        filter(({ id, audio, result }) => {
          if (!audio) return false
          if (id === cn.dict && audio.py) return true
          if (id === en.dict && (audio.uk || audio.us)) return true
          return (
            id === machine.dict &&
            !!(result as MachineTranslateResult<DictID>)[machine.src].audio
          )
        }),
        take(1),
        tap(({ id, audio, result }) => {
          if (id === cn.dict) {
            return message.send({ type: 'PLAY_AUDIO', payload: audio!.py! })
          }

          if (id === en.dict) {
            const src =
              en.accent === 'us'
                ? audio!.us || audio!.uk
                : audio!.uk || audio!.us
            return message.send({ type: 'PLAY_AUDIO', payload: src! })
          }

          message.send({
            type: 'PLAY_AUDIO',
            payload: (result as MachineTranslateResult<DictID>)[machine.src]
              .audio!
          })
        }),
        // never pass to down stream
        filter((value): value is never => false)
      )

      return merge(
        from(isInNotebook(word).catch(() => false)).pipe(
          map(
            (isInNotebook): StoreAction => ({
              type: 'WORD_IN_NOTEBOOK',
              payload: isInNotebook
            })
          )
        ),
        searchResults$$.pipe(
          map(
            ({ id, result }): StoreAction => ({
              type: 'SEARCH_END',
              payload: { id, result }
            })
          )
        ),
        playAudio$
      )
    })
  )

export default searchStartEpic
