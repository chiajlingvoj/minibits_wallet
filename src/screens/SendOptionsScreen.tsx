import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import {spacing, useThemeColor, colors} from '../theme'
import {WalletStackScreenProps} from '../navigation'
import {
  Button,
  Icon,
  Card,
  Screen,
  InfoModal,
  ErrorModal,
  ListItem,
  BottomModal,
  Text,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../utils/logger'
import AppError from '../utils/AppError'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { infoMessage } from '../utils/utils'
import { IncomingDataType, IncomingParser } from '../services/incomingParser'

export enum SendOption {
    SEND_TOKEN = 'SEND_TOKEN',
    PASTE_OR_SCAN_INVOICE = 'PASTE_OR_SCAN_INVOICE',
    SHOW_TOKEN = 'SHOW_TOKEN',
    PAY_PAYMENT_REQUEST = 'PAY_PAYMENT_REQUEST',
    LNURL_PAY = 'LNURL_PAY',
    DONATION = 'DONATION',
}

export const SendOptionsScreen: FC<WalletStackScreenProps<'SendOptions'>> = observer(
  function SendOptionsScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const isInternetReachable = useIsInternetReachable()    
    const [error, setError] = useState<AppError | undefined>()


    const gotoContacts = function () {
        navigation.navigate('ContactsNavigator', {
            screen: 'Contacts', 
            params: {paymentOption: SendOption.SEND_TOKEN}})
    }


    const gotoSend = function () {
        navigation.navigate('Send', {            
            paymentOption: SendOption.SHOW_TOKEN}
        )
    }


    const onScan = async function () {
        navigation.navigate('Scan', {expectedType: IncomingDataType.INVOICE})
    }


    const onPaste = async function () {
        const clipboard = await Clipboard.getString()
        if (!clipboard) {
            infoMessage('Please copy the invoice first.')
        }

        try {
            const incomingData = IncomingParser.findAndExtract(clipboard, IncomingDataType.INVOICE)

            infoMessage('Found lightning invoice in the clipboard.')                
            setTimeout(async() => IncomingParser.navigateWithIncomingData(incomingData, navigation), 1000)
            return
            
        } catch (e: any) {
            const lnurlResult = IncomingParser.findAndExtract(clipboard, IncomingDataType.LNURL)
                    
            if(lnurlResult) {
                log.trace('Found LNURL instead of an invoice')
                return IncomingParser.navigateWithIncomingData(lnurlResult, navigation)                
            }

            const lnurlAddress = IncomingParser.findAndExtract(clipboard, IncomingDataType.LNURL_ADDRESS)

            if(lnurlAddress) {
                log.trace('Found LNURL address instead of an invoice')
                return IncomingParser.navigateWithIncomingData(lnurlAddress, navigation)                
            }
            
            e.params = clipboard
            handleError(e)                    
        }
    }


    const handleError = function (e: AppError): void {
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
              preset="heading"
              tx="sendScreen.title"
              style={{color: 'white'}}
            />
        </View>
        <View style={$contentContainer}>          
            <Card
                style={$optionsCard}
                ContentComponent={
                    <>
                    <ListItem
                        tx="sendScreen.sendToContact"
                        subTx="sendScreen.sendToContactDescription"
                        leftIcon='faPaperPlane'
                        leftIconColor={colors.palette.secondary300}
                        leftIconInverse={true}
                        style={$item}
                        bottomSeparator={true}
                        onPress={gotoContacts}
                    />
                    <ListItem
                        tx="sendScreen.scanToSend"
                        subTx="sendScreen.scanToSendDescription"
                        leftIcon='faBolt'
                        leftIconColor={colors.palette.accent300}
                        leftIconInverse={true}
                        style={$item}                    
                        onPress={onScan}
                    />
                    <Button 
                        onPress={onPaste}
                        tx='sendScreen.pasteToSend'
                        preset='tertiary'
                        textStyle={{fontSize: 14, color: iconColor}}
                        style={{alignSelf: 'flex-start', marginLeft: 33}}
                    />
                    <ListItem
                        tx="sendScreen.showOrShareToken"
                        subTx="sendScreen.showOrShareTokenDescription"
                        leftIcon='faQrcode'
                        leftIconColor={colors.palette.success200}
                        leftIconInverse={true}
                        style={$item}
                        topSeparator={true}
                        onPress={gotoSend}
                    />
                    </>
              }

            />
        </View>
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $optionsCard: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  marginBottom: spacing.small,
  // paddingTop: 0,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $amountContainer: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
}

const $amountToReceive: TextStyle = {
  flex: 1,
  paddingTop: spacing.extraLarge + 10,
  fontSize: 52,
  fontWeight: '400',
  textAlignVertical: 'center',
  color: 'white',
}